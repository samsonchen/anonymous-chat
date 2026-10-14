// 階段一的模擬版聊天服務：沒有伺服器，靠瀏覽器自己的兩個功能撐起整個聊天室。
//   - BroadcastChannel：同一個瀏覽器的不同分頁互相傳話（開兩個分頁 = 兩個人）
//   - localStorage：存歷史訊息
// 它要遵守和真正聊天室一樣的規則，這樣階段二換成 Supabase 時，畫面不用改。
//
// 測試用的網址參數（只有模擬版有）：
//   ?demo=1          放進幾個假的在線者，自己一個人也有人聊天
//   ?fail=history    第一次載入歷史訊息會失敗（測「重試」）
//   ?fail=send       第一次送訊息會失敗（測「重送」）
//   以上可以合併，例如 ?demo=1&fail=history,send

import type { ChatService } from './ChatService'
import {
  ChatError,
  type ChatEvent,
  type ConnectionState,
  type Member,
  type Message,
} from './types'
import { newId } from './ids'
import { compareMembers, compareMessages } from './order'
import { readJSON, writeJSON } from './storage'
import {
  RECENT_LIMIT,
  nicknameKey,
  normalizeNickname,
  validateMessage,
  validateNickname,
} from './validation'

const CHANNEL_NAME = 'anonymous-chat-mock'
const STORE_KEY = 'anonymous-chat:mock:messages'

const HEARTBEAT_MS = 2000
/** 超過這麼久沒聽到某個分頁的心跳，就當作它離開了（例如分頁當掉、沒機會說再見） */
const MEMBER_TIMEOUT_MS = 6000
/** 進入時等其他分頁回報名單的時間 */
const SYNC_WAIT_MS = 350
const CONNECT_DELAY_MS = 400
const SEND_DELAY_MS = 150
/** 斷線超過這麼久，狀態從「重新連線中」變成「無法連線」 */
const OFFLINE_AFTER_MS = 60_000
/** 歷史訊息保留多久（對應資料庫的自動清除，預設 7 天） */
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000
const STORE_MAX = 300

type Wire =
  | { t: 'who' }
  | { t: 'here'; member: Member }
  | { t: 'hello'; member: Member }
  | { t: 'ping'; member: Member }
  | { t: 'bye'; clientId: string }
  | { t: 'msg'; message: Message }

interface Entry {
  member: Member
  seen: number
  bot?: boolean
}

const BOT_LINES = [
  '大家午安，今天好熱',
  '有人在嗎？',
  '剛剛那個梗太好笑了',
  '我先去吃飯，晚點回來',
  '這裡是大家都在同一間的聊天室',
  '第一次來\n這裡是什麼聊天室？',
]

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export class MockChatService implements ChatService {
  private listeners = new Set<(event: ChatEvent) => void>()
  private readonly clientId = newId()
  private channel: BroadcastChannel | null = null
  private me: Member | null = null
  private roster = new Map<string, Entry>()
  private collecting: Map<string, Member> | null = null
  private status: ConnectionState = 'connecting'
  private online = typeof navigator === 'undefined' ? true : navigator.onLine
  private heartbeatTimer: number | undefined
  private offlineTimer: number | undefined
  private botTimer: number | undefined
  private botLeft = false

  private readonly demo: boolean
  private failHistory: boolean
  private failSend: boolean

  constructor() {
    const params = new URLSearchParams(window.location.search)
    const fails = (params.get('fail') ?? '').split(',')
    this.demo = params.get('demo') === '1'
    this.failHistory = fails.includes('history')
    this.failSend = fails.includes('send')

    window.addEventListener('online', this.handleOnline)
    window.addEventListener('offline', this.handleOffline)
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
    if (this.me) this.leave()

    const nickname = normalizeNickname(rawNickname)
    if (validateNickname(nickname) !== null) throw new ChatError('NICKNAME_INVALID')

    this.setStatus('connecting')
    await sleep(CONNECT_DELAY_MS)
    if (!this.online) {
      this.setStatus('offline')
      throw new ChatError('NOT_CONNECTED')
    }

    // 先問其他分頁：現在有誰在線上？
    this.openChannel()
    const found = new Map<string, Member>()
    this.collecting = found
    this.post({ t: 'who' })
    await sleep(SYNC_WAIT_MS)
    this.collecting = null

    const others = [...found.values(), ...this.botMembers()]
    const key = nicknameKey(nickname)
    if (others.some((m) => nicknameKey(m.nickname) === key)) {
      this.closeChannel()
      throw new ChatError('NICKNAME_TAKEN')
    }

    const me: Member = { nickname, clientId: this.clientId, joinedAt: new Date().toISOString() }
    this.me = me
    this.roster.clear()
    const now = Date.now()
    for (const m of found.values()) this.roster.set(m.clientId, { member: m, seen: now })
    for (const m of this.botMembers()) this.roster.set(m.clientId, { member: m, seen: now, bot: true })
    this.roster.set(me.clientId, { member: me, seen: now })

    this.post({ t: 'hello', member: me })
    this.startHeartbeat()
    this.setStatus('connected')
    this.emitRoster()

    if (this.demo) {
      this.seedHistory()
      this.startBots()
    }
  }

  leave(): void {
    if (this.me) this.post({ t: 'bye', clientId: this.clientId })
    this.teardown()
  }

  async send(content: string, id: string): Promise<void> {
    if (!this.me || this.status !== 'connected' || !this.online) throw new ChatError('NOT_CONNECTED')
    const problem = validateMessage(content)
    if (problem) throw new ChatError(problem)

    if (this.failSend) {
      this.failSend = false
      await sleep(300)
      throw new ChatError('SEND_FAILED')
    }

    await sleep(SEND_DELAY_MS)
    if (!this.me || !this.online) throw new ChatError('SEND_FAILED')

    const message: Message = {
      id,
      nickname: this.me.nickname,
      content,
      createdAt: new Date().toISOString(),
    }
    // 同一個 id 重送時，不會多出一則
    const stored = this.persist(message)
    this.post({ t: 'msg', message: stored })
    this.emit({ type: 'message', message: stored })
  }

  async loadRecent(): Promise<Message[]> {
    if (this.failHistory) {
      this.failHistory = false
      await sleep(400)
      throw new ChatError('LOAD_FAILED')
    }
    await sleep(120)
    const cutoff = Date.now() - RETENTION_MS
    return this.readStore()
      .filter((m) => Date.parse(m.createdAt) >= cutoff)
      .sort(compareMessages)
      .slice(-RECENT_LIMIT)
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

  private emitRoster(): void {
    const members = [...this.roster.values()].map((e) => e.member).sort(compareMembers)
    this.emit({ type: 'roster', members })
  }

  private emitNotice(kind: 'join' | 'leave', nickname: string): void {
    this.emit({ type: 'notice', kind, nickname, at: new Date().toISOString() })
  }

  // ───────────── 分頁之間的通訊 ─────────────

  private openChannel(): void {
    if (this.channel || typeof BroadcastChannel === 'undefined') return
    this.channel = new BroadcastChannel(CHANNEL_NAME)
    this.channel.onmessage = (e: MessageEvent<Wire>) => this.handleWire(e.data)
  }

  private closeChannel(): void {
    this.channel?.close()
    this.channel = null
  }

  private post(wire: Wire): void {
    this.channel?.postMessage(wire)
  }

  private handleWire(wire: Wire): void {
    // 模擬斷線時，聽不到任何人
    if (!this.online) return

    switch (wire.t) {
      case 'who':
        if (this.me) this.post({ t: 'here', member: this.me })
        break

      case 'here':
        if (this.collecting) {
          this.collecting.set(wire.member.clientId, wire.member)
        } else if (this.me) {
          this.upsert(wire.member, false)
        }
        break

      case 'hello':
        if (this.me) this.upsert(wire.member, true)
        break

      case 'ping':
        if (this.me) this.upsert(wire.member, false)
        break

      case 'bye':
        if (this.me) this.remove(wire.clientId, true)
        break

      case 'msg':
        if (this.me) this.emit({ type: 'message', message: wire.message })
        break
    }
  }

  /** 登記或更新一位在線者；announce 為 true 且是新面孔時，顯示「進來了」 */
  private upsert(member: Member, announce: boolean): void {
    if (!this.me || member.clientId === this.me.clientId) return

    // 同一個代號有兩個人：加入較晚的那個退出
    if (nicknameKey(member.nickname) === nicknameKey(this.me.nickname)) {
      if (compareMembers(member, this.me) < 0) {
        this.kicked()
        return
      }
    }

    const existing = this.roster.get(member.clientId)
    this.roster.set(member.clientId, { member, seen: Date.now(), bot: existing?.bot })
    if (!existing) {
      if (announce) this.emitNotice('join', member.nickname)
      this.emitRoster()
    }
  }

  private remove(clientId: string, announce: boolean): void {
    const entry = this.roster.get(clientId)
    if (!entry || clientId === this.clientId) return
    this.roster.delete(clientId)
    if (announce) this.emitNotice('leave', entry.member.nickname)
    this.emitRoster()
  }

  private kicked(): void {
    this.post({ t: 'bye', clientId: this.clientId })
    this.teardown()
    this.emit({ type: 'kicked', reason: 'nickname-conflict' })
  }

  // ───────────── 心跳（誰還在線上） ─────────────

  private startHeartbeat(): void {
    this.stopHeartbeat()
    this.heartbeatTimer = window.setInterval(() => {
      if (!this.me || !this.online) return
      this.post({ t: 'ping', member: this.me })

      const now = Date.now()
      let changed = false
      for (const [clientId, entry] of this.roster) {
        if (entry.bot || clientId === this.clientId) continue
        if (now - entry.seen > MEMBER_TIMEOUT_MS) {
          this.roster.delete(clientId)
          this.emitNotice('leave', entry.member.nickname)
          changed = true
        }
      }
      if (changed) this.emitRoster()
    }, HEARTBEAT_MS)
  }

  private stopHeartbeat(): void {
    window.clearInterval(this.heartbeatTimer)
    this.heartbeatTimer = undefined
  }

  // ───────────── 斷線與重連（用瀏覽器的離線事件模擬） ─────────────

  private handleOffline = (): void => {
    this.online = false
    if (!this.me) return
    this.setStatus('reconnecting')
    window.clearTimeout(this.offlineTimer)
    this.offlineTimer = window.setTimeout(() => this.setStatus('offline'), OFFLINE_AFTER_MS)
  }

  private handleOnline = (): void => {
    this.online = true
    window.clearTimeout(this.offlineTimer)
    if (this.me) void this.reconnect()
  }

  private handlePageHide = (): void => {
    if (this.me) this.post({ t: 'bye', clientId: this.clientId })
  }

  /** 重連：重新問一次名單，再重新登記上線。斷線期間的進出提示不補發 */
  private async reconnect(): Promise<void> {
    const me = this.me
    if (!me) return

    this.openChannel()
    const found = new Map<string, Member>()
    this.collecting = found
    this.post({ t: 'who' })
    await sleep(SYNC_WAIT_MS)
    this.collecting = null
    if (!this.me || !this.online) return

    // 斷線期間，別人用了我的代號
    const key = nicknameKey(me.nickname)
    if ([...found.values()].some((m) => nicknameKey(m.nickname) === key)) {
      this.kicked()
      return
    }

    const now = Date.now()
    this.roster.clear()
    for (const m of found.values()) this.roster.set(m.clientId, { member: m, seen: now })
    for (const m of this.botMembers()) this.roster.set(m.clientId, { member: m, seen: now, bot: true })
    this.roster.set(me.clientId, { member: me, seen: now })

    this.post({ t: 'hello', member: me })
    this.setStatus('connected')
    this.emitRoster()
  }

  private teardown(): void {
    this.stopHeartbeat()
    this.stopBots()
    window.clearTimeout(this.offlineTimer)
    this.closeChannel()
    this.me = null
    this.roster.clear()
    this.collecting = null
    this.botLeft = false
    this.status = 'connecting'
  }

  // ───────────── 歷史訊息 ─────────────

  private readStore(): Message[] {
    const list = readJSON<Message[]>(STORE_KEY, [])
    return Array.isArray(list) ? list : []
  }

  /** 存進歷史。同一個 id 已經存在就不重複存，並回傳原本那一則 */
  private persist(message: Message): Message {
    const list = this.readStore()
    const existing = list.find((m) => m.id === message.id)
    if (existing) return existing
    const cutoff = Date.now() - RETENTION_MS
    const next = [...list, message]
      .filter((m) => Date.parse(m.createdAt) >= cutoff)
      .sort(compareMessages)
      .slice(-STORE_MAX)
    writeJSON(STORE_KEY, next)
    return message
  }

  // ───────────── 展示用的假在線者（?demo=1） ─────────────

  private botMembers(): Member[] {
    if (!this.demo) return []
    const base = Date.now() - 60 * 60 * 1000
    const names = this.botLeft ? ['Mei', '小明'] : ['Mei', '小明', '路人乙']
    return names.map((nickname, i) => ({
      nickname,
      clientId: `bot-${i + 1}`,
      joinedAt: new Date(base + i * 1000).toISOString(),
    }))
  }

  private seedHistory(): void {
    if (this.readStore().length > 0) return
    const now = Date.now()
    const seeds: Array<[string, string, number]> = [
      ['Mei', '大家午安，今天好熱', 12],
      ['小明', '對啊，我在公司開冷氣還是熱', 10],
      ['路人乙', '第一次來\n這裡是什麼聊天室？', 7],
    ]
    for (const [nickname, content, minutesAgo] of seeds) {
      this.persist({
        id: newId(),
        nickname,
        content,
        createdAt: new Date(now - minutesAgo * 60 * 1000).toISOString(),
      })
    }
  }

  private startBots(): void {
    this.stopBots()
    let tick = 0
    this.botTimer = window.setInterval(() => {
      if (!this.me || !this.online) return
      tick += 1

      // 每隔幾次，讓「路人乙」離開或回來，測進出提示
      if (tick % 3 === 0) {
        const bot = this.roster.get('bot-3')
        if (bot && !this.botLeft) {
          this.botLeft = true
          this.roster.delete('bot-3')
          this.emitNotice('leave', bot.member.nickname)
          this.emitRoster()
        } else if (this.botLeft) {
          this.botLeft = false
          const back = this.botMembers().find((m) => m.clientId === 'bot-3')
          if (back) {
            this.roster.set(back.clientId, { member: back, seen: Date.now(), bot: true })
            this.emitNotice('join', back.nickname)
            this.emitRoster()
          }
        }
        return
      }

      const speakers = [...this.roster.values()].filter((e) => e.bot)
      if (speakers.length === 0) return
      const speaker = speakers[Math.floor(Math.random() * speakers.length)].member
      const content = BOT_LINES[Math.floor(Math.random() * BOT_LINES.length)]
      const message = this.persist({
        id: newId(),
        nickname: speaker.nickname,
        content,
        createdAt: new Date().toISOString(),
      })
      this.post({ t: 'msg', message })
      this.emit({ type: 'message', message })
    }, 9000)
  }

  private stopBots(): void {
    window.clearInterval(this.botTimer)
    this.botTimer = undefined
  }
}
