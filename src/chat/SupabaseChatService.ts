// 階段二的聊天服務：用 Supabase 的三個功能撐起聊天室。
//   - Presence：誰在線上（頻道 lobby，key 是代號）
//   - Postgres Changes：新訊息即時推送（messages 表的 INSERT）
//   - 一般資料庫存取：送出訊息、取歷史
// 對應關係見 docs/architecture.md 5.4。畫面只認 ChatService 介面，不知道這裡的細節。
//
// 這個檔案只會用到 Project URL 和 publishable key。

import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js'
import type { ChatService } from './ChatService'
import { newId } from './ids'
import { compareMembers, compareMessages } from './order'
import {
  ChatError,
  type ChatEvent,
  type ConnectionState,
  type Member,
  type Message,
} from './types'
import {
  RECENT_LIMIT,
  nicknameKey,
  normalizeNickname,
  validateMessage,
  validateNickname,
} from './validation'

const CHANNEL_NAME = 'lobby'
/** 等頻道訂閱成功的時間 */
const SUBSCRIBE_TIMEOUT_MS = 10_000
/** 等 Presence 名單送來的時間 */
const SYNC_TIMEOUT_MS = 5_000
/** 一般資料庫請求的時間上限 */
const REQUEST_TIMEOUT_MS = 10_000
/** 斷線超過這麼久，狀態從「重新連線中」變成「無法連線」 */
const OFFLINE_AFTER_MS = 60_000
/** 重新登記上線失敗時，隔多久再試 */
const RECOVER_RETRY_MS = 3_000

/** messages 表的一列 */
interface MessageRow {
  id: string
  nickname: string
  content: string
  created_at: string
}

function isMessageRow(value: unknown): value is MessageRow {
  if (typeof value !== 'object' || value === null) return false
  const row = value as Record<string, unknown>
  return (
    typeof row.id === 'string' &&
    typeof row.nickname === 'string' &&
    typeof row.content === 'string' &&
    typeof row.created_at === 'string'
  )
}

function toMessage(row: MessageRow): Message {
  return {
    id: row.id,
    nickname: row.nickname,
    content: row.content,
    createdAt: new Date(row.created_at).toISOString(),
  }
}

/** Presence 裡別人登記的資料不可信，要逐欄檢查 */
function toMember(value: unknown): Member | null {
  if (typeof value !== 'object' || value === null) return null
  const meta = value as Record<string, unknown>
  if (
    typeof meta.nickname !== 'string' ||
    typeof meta.clientId !== 'string' ||
    typeof meta.joinedAt !== 'string'
  ) {
    return null
  }
  return { nickname: meta.nickname, clientId: meta.clientId, joinedAt: meta.joinedAt }
}

export class SupabaseChatService implements ChatService {
  private readonly client: SupabaseClient
  private readonly clientId = newId()
  private listeners = new Set<(event: ChatEvent) => void>()

  private channel: RealtimeChannel | null = null
  /** 上一個頻道還在關閉時，新的 join 要等它關完（兩個頻道同名會互相干擾） */
  private closing: Promise<void> = Promise.resolve()
  /** 自己的登記資料。進入的過程中就有值 */
  private self: Member | null = null
  /** 已經成功進入聊天室 */
  private joined = false
  private status: ConnectionState = 'connecting'
  private browserOnline = typeof navigator === 'undefined' ? true : navigator.onLine

  /** 目前看得到的在線者（同一個代號只留最早的那個），clientId → Member */
  private roster = new Map<string, Member>()
  /** 這個頻道是否已收到過第一份名單 */
  private synced = false
  /** 已經有一份可以拿來比對的名單，之後的差別才算「進來了」「離開了」 */
  private baselineReady = false
  private syncWaiters = new Set<() => void>()
  private subscribeWaiter: { resolve: () => void; reject: (error: ChatError) => void } | null = null
  private offlineTimer: number | undefined
  private recoverTimer: number | undefined
  private recovering = false

  constructor(url: string, publishableKey: string) {
    // 不用 Supabase 的登入功能，所以不存、也不更新任何登入資料
    this.client = createClient(url, publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    })

    window.addEventListener('online', this.handleBrowserOnline)
    window.addEventListener('offline', this.handleBrowserOffline)
    window.addEventListener('pagehide', this.handlePageHide)
  }

  // ───────────── ChatService ─────────────

  subscribe(listener: (event: ChatEvent) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  async join(rawNickname: string): Promise<void> {
    this.leave()

    const nickname = normalizeNickname(rawNickname)
    if (validateNickname(nickname) !== null) throw new ChatError('NICKNAME_INVALID')
    if (!this.browserOnline) {
      this.setStatus('offline')
      throw new ChatError('NOT_CONNECTED')
    }

    this.setStatus('connecting')
    await this.closing

    const self: Member = { nickname, clientId: this.clientId, joinedAt: new Date().toISOString() }
    const key = nicknameKey(nickname)
    const channel = this.client.channel(CHANNEL_NAME, {
      config: {
        presence: { key, enabled: true },
        // 等到「新訊息的推送」真的準備好才算訂閱成功，這樣訂閱完成後才查歷史不會漏
        postgres_changes_options: { wait: true },
      },
    })
    this.channel = channel
    this.self = self

    channel.on('presence', { event: 'sync' }, () => this.handleSync(channel))
    channel.on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'messages' },
      (payload) => {
        if (channel !== this.channel || !isMessageRow(payload.new)) return
        this.emit({ type: 'message', message: toMessage(payload.new) })
      },
    )

    try {
      // 1. 先訂閱（之後的新訊息會開始進來）
      await this.subscribeChannel(channel)

      // 2. 看名單：這個代號已經有人在用了嗎？
      if (!(await this.untilSync(() => this.synced, SYNC_TIMEOUT_MS))) {
        throw new ChatError('NOT_CONNECTED')
      }
      if (this.membersWithKey(channel, key).length > 0) throw new ChatError('NICKNAME_TAKEN')

      // 3. 登記上線，等自己的登記出現在名單裡
      if ((await channel.track(self)) !== 'ok') throw new ChatError('NOT_CONNECTED')
      const seen = await this.untilSync(
        () => this.membersWithKey(channel, key).some((m) => m.clientId === self.clientId),
        SYNC_TIMEOUT_MS,
      )
      if (!seen) throw new ChatError('NOT_CONNECTED')

      // 4. 登記後再檢查一次：同時搶同一個代號時，joinedAt 較早的留下
      if (this.winner(channel, key)?.clientId !== self.clientId) {
        throw new ChatError('NICKNAME_TAKEN')
      }
    } catch (error) {
      this.teardown()
      if (error instanceof ChatError) throw error
      throw new ChatError('NOT_CONNECTED')
    }

    if (channel !== this.channel) throw new ChatError('NOT_CONNECTED')
    this.joined = true
    this.baselineReady = true
    this.setStatus('connected')
    this.refreshRoster(channel)
  }

  leave(): void {
    this.teardown()
  }

  async send(content: string, id: string): Promise<void> {
    const self = this.self
    if (!self || !this.joined || this.status !== 'connected') throw new ChatError('NOT_CONNECTED')
    const problem = validateMessage(content)
    if (problem) throw new ChatError(problem)

    let error: { code?: string; message?: string } | null
    try {
      const result = await this.client
        .from('messages')
        .insert({ id, nickname: self.nickname, content })
        .abortSignal(AbortSignal.timeout(REQUEST_TIMEOUT_MS))
      error = result.error
    } catch {
      throw new ChatError('SEND_FAILED')
    }
    if (!error) return

    // 同一個 id 已經存在：之前那次其實送成功了，只是沒收到通知。補送一次通知，讓畫面標成已送達
    if (error.code === '23505') {
      await this.emitStored(id)
      return
    }
    if (error.message === 'RATE_LIMITED') throw new ChatError('RATE_LIMITED')
    throw new ChatError('SEND_FAILED')
  }

  async loadRecent(): Promise<Message[]> {
    try {
      const { data, error } = await this.client
        .from('messages')
        .select('id, nickname, content, created_at')
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(RECENT_LIMIT)
        .abortSignal(AbortSignal.timeout(REQUEST_TIMEOUT_MS))
      if (error || !Array.isArray(data)) throw new ChatError('LOAD_FAILED')
      return data.filter(isMessageRow).map(toMessage).sort(compareMessages)
    } catch (error) {
      if (error instanceof ChatError) throw error
      throw new ChatError('LOAD_FAILED')
    }
  }

  // ───────────── 事件 ─────────────

  private emit(event: ChatEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event)
      } catch (error) {
        console.error(error)
      }
    }
  }

  private setStatus(state: ConnectionState): void {
    if (this.status === state) return
    this.status = state
    this.emit({ type: 'status', state })
  }

  // ───────────── 頻道與名單 ─────────────

  /** 訂閱頻道，等到成功。失敗或逾時丟出 NOT_CONNECTED */
  private subscribeChannel(channel: RealtimeChannel): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.subscribeWaiter = null
        reject(new ChatError('NOT_CONNECTED'))
      }, SUBSCRIBE_TIMEOUT_MS)
      this.subscribeWaiter = {
        resolve: () => {
          window.clearTimeout(timer)
          this.subscribeWaiter = null
          resolve()
        },
        reject: (error) => {
          window.clearTimeout(timer)
          this.subscribeWaiter = null
          reject(error)
        },
      }
      channel.subscribe((status) => this.handleChannelStatus(channel, status))
    })
  }

  private handleChannelStatus(channel: RealtimeChannel, status: string): void {
    if (channel !== this.channel) return

    if (status === 'SUBSCRIBED') {
      this.subscribeWaiter?.resolve()
      // 斷線後自動重連成功：重新登記上線，並重新對一次名單
      if (this.joined) void this.recover()
      return
    }

    // CHANNEL_ERROR、TIMED_OUT、CLOSED
    if (this.subscribeWaiter) this.subscribeWaiter.reject(new ChatError('NOT_CONNECTED'))
    else if (this.joined) this.markReconnecting()
  }

  /** 等到下一次（或目前就已經）符合條件。逾時回傳 false */
  private untilSync(check: () => boolean, ms: number): Promise<boolean> {
    return new Promise((resolve) => {
      if (check()) {
        resolve(true)
        return
      }
      const done = () => {
        if (!check()) return
        cleanup()
        resolve(true)
      }
      const timer = window.setTimeout(() => {
        cleanup()
        resolve(false)
      }, ms)
      const cleanup = () => {
        window.clearTimeout(timer)
        this.syncWaiters.delete(done)
      }
      this.syncWaiters.add(done)
    })
  }

  /** 頻道目前的所有登記，不管是誰 */
  private presentMembers(channel: RealtimeChannel): Member[] {
    const members: Member[] = []
    for (const metas of Object.values(channel.presenceState())) {
      for (const meta of metas) {
        const member = toMember(meta)
        if (member) members.push(member)
      }
    }
    return members
  }

  private membersWithKey(channel: RealtimeChannel, key: string): Member[] {
    return this.presentMembers(channel).filter((m) => nicknameKey(m.nickname) === key)
  }

  /** 同一個代號有多筆登記時，joinedAt 最早的留下 */
  private winner(channel: RealtimeChannel, key: string): Member | undefined {
    return this.membersWithKey(channel, key).sort(compareMembers)[0]
  }

  private handleSync(channel: RealtimeChannel): void {
    if (channel !== this.channel) return
    this.synced = true
    for (const waiter of [...this.syncWaiters]) waiter()
    if (!this.joined) return

    // 進入之後才發現有人比我早登記同一個代號：我退出
    const self = this.self
    if (self && this.winner(channel, nicknameKey(self.nickname))?.clientId !== self.clientId) {
      this.teardown()
      this.emit({ type: 'kicked', reason: 'nickname-conflict' })
      return
    }
    this.refreshRoster(channel)
  }

  /** 重新算名單；和上一份比對，找出誰進來、誰離開 */
  private refreshRoster(channel: RealtimeChannel): void {
    const byKey = new Map<string, Member>()
    for (const member of this.presentMembers(channel)) {
      const key = nicknameKey(member.nickname)
      const current = byKey.get(key)
      if (!current || compareMembers(member, current) < 0) byKey.set(key, member)
    }
    const next = new Map([...byKey.values()].map((m) => [m.clientId, m]))

    if (this.baselineReady) {
      const at = new Date().toISOString()
      for (const [clientId, member] of next) {
        if (!this.roster.has(clientId) && clientId !== this.clientId) {
          this.emit({ type: 'notice', kind: 'join', nickname: member.nickname, at })
        }
      }
      for (const [clientId, member] of this.roster) {
        if (!next.has(clientId) && clientId !== this.clientId) {
          this.emit({ type: 'notice', kind: 'leave', nickname: member.nickname, at })
        }
      }
    }

    this.roster = next
    this.baselineReady = true
    this.emit({ type: 'roster', members: [...next.values()].sort(compareMembers) })
  }

  // ───────────── 斷線與重連 ─────────────

  private markReconnecting(): void {
    this.setStatus('reconnecting')
    // 斷線期間的進出提示不補發：重連後的第一份名單只當作新的比對基準
    this.baselineReady = false
    if (this.offlineTimer === undefined) {
      this.offlineTimer = window.setTimeout(() => {
        this.offlineTimer = undefined
        if (this.status === 'reconnecting') this.setStatus('offline')
      }, OFFLINE_AFTER_MS)
    }
  }

  /** 連線恢復後，重新登記上線。supabase-js 會自己重新訂閱頻道，登記要我們再做一次 */
  private async recover(): Promise<void> {
    const channel = this.channel
    const self = this.self
    if (!channel || !self || !this.joined || this.recovering) return
    this.recovering = true
    window.clearTimeout(this.recoverTimer)
    try {
      const result = channel.state === 'joined' ? await channel.track(self) : 'error'
      if (channel !== this.channel) return
      if (result === 'ok') {
        window.clearTimeout(this.offlineTimer)
        this.offlineTimer = undefined
        this.setStatus('connected')
        return
      }
    } catch {
      // 下面會重試
    } finally {
      this.recovering = false
    }
    if (channel === this.channel && this.status !== 'connected') {
      this.recoverTimer = window.setTimeout(() => void this.recover(), RECOVER_RETRY_MS)
    }
  }

  private handleBrowserOffline = (): void => {
    this.browserOnline = false
    if (this.joined) this.markReconnecting()
  }

  private handleBrowserOnline = (): void => {
    this.browserOnline = true
    if (this.joined && this.status !== 'connected') void this.recover()
  }

  /** 關分頁前盡量先通知伺服器自己離開，其他人就不用等到連線逾時才看到「離開了」 */
  private handlePageHide = (): void => {
    if (this.channel && this.joined) void this.channel.untrack().catch(() => {})
  }

  // ───────────── 其他 ─────────────

  /** 查出某個 id 的訊息並通知畫面（重送時，原本那則已經存在的情況） */
  private async emitStored(id: string): Promise<void> {
    try {
      const { data } = await this.client
        .from('messages')
        .select('id, nickname, content, created_at')
        .eq('id', id)
        .abortSignal(AbortSignal.timeout(REQUEST_TIMEOUT_MS))
        .maybeSingle()
      if (isMessageRow(data)) this.emit({ type: 'message', message: toMessage(data) })
    } catch {
      // 查不到就算了，畫面會在逾時後讓使用者再重送
    }
  }

  /** 關閉頻道，清掉所有狀態。不通知畫面（要通知的地方自己發事件） */
  private teardown(): void {
    window.clearTimeout(this.offlineTimer)
    window.clearTimeout(this.recoverTimer)
    this.offlineTimer = undefined
    this.recoverTimer = undefined
    this.recovering = false

    const channel = this.channel
    this.channel = null
    this.self = null
    this.joined = false
    this.synced = false
    this.baselineReady = false
    this.roster = new Map()
    this.status = 'connecting'
    this.subscribeWaiter = null
    this.syncWaiters.clear()

    if (channel) {
      const previous = this.closing
      this.closing = (async () => {
        await previous
        try {
          await channel.untrack()
        } catch {
          // 已經斷線就不用取消登記了
        }
        try {
          await this.client.removeChannel(channel)
        } catch {
          // 同上
        }
      })()
    }
  }
}
