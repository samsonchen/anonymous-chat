// 把聊天服務的事件轉成畫面要的狀態，並提供畫面能下的動作。
// 這裡只認 ChatService 介面，不知道背後是模擬版還是 Supabase。

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { getChatService } from '../chat/createChatService'
import { JOIN_ERROR_TEXT, SEND_ERROR_TEXT } from '../chat/copy'
import { newId } from '../chat/ids'
import { readString, writeString } from '../chat/storage'
import {
  ChatError,
  type ConnectionState,
  type ErrorCode,
  type Member,
  type Message,
} from '../chat/types'
import {
  canSendNow,
  normalizeMessage,
  normalizeNickname,
  validateMessage,
  validateNickname,
} from '../chat/validation'
import { timelineReducer, type TimelineItem } from './timeline'

const NICKNAME_KEY = 'anonymous-chat:nickname'
/** 送出後這麼久還沒收到回傳，就標示送出失敗 */
const DELIVERY_TIMEOUT_MS = 8000
/** 重新整理後被自己的舊連線擋住時，重試的次數與間隔 */
const OLD_CONNECTION_RETRIES = 5
const OLD_CONNECTION_RETRY_MS = 2000
const TOAST_MS = 4000

export type Phase = 'join' | 'chat'
export type HistoryState = 'loading' | 'ready' | 'error'

export interface ChatApi {
  phase: Phase
  /** 目前使用的代號（進入聊天室後才有意義） */
  nickname: string
  /** 進入畫面上，代號欄位預先填的值 */
  lastNickname: string
  connecting: boolean
  joinError: string | null
  /** 例如「正在確認舊連線是否已結束…」 */
  joinHint: string | null
  status: ConnectionState
  members: Member[]
  items: TimelineItem[]
  history: HistoryState
  toast: string | null
  join: (nickname: string) => Promise<void>
  leave: () => void
  clearJoinError: () => void
  /** 回傳 true 代表訊息已受理，輸入框可以清空；false 代表被擋下，內容要保留 */
  send: (raw: string) => boolean
  retry: (id: string) => void
  reloadHistory: () => void
  showToast: (text: string) => void
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function errorCode(error: unknown): ErrorCode | null {
  return error instanceof ChatError ? error.code : null
}

export function useChat(): ChatApi {
  const service = useMemo(() => getChatService(), [])

  const [phase, setPhase] = useState<Phase>('join')
  const [nickname, setNickname] = useState('')
  const [lastNickname, setLastNickname] = useState(() => readString(NICKNAME_KEY) ?? '')
  const [connecting, setConnecting] = useState(false)
  const [joinError, setJoinError] = useState<string | null>(null)
  const [joinHint, setJoinHint] = useState<string | null>(null)
  const [status, setStatus] = useState<ConnectionState>('connecting')
  const [members, setMembers] = useState<Member[]>([])
  const [items, dispatch] = useReducer(timelineReducer, [])
  const [history, setHistory] = useState<HistoryState>('loading')
  const [toast, setToast] = useState<{ id: number; text: string } | null>(null)

  const phaseRef = useRef<Phase>('join')
  const previousStatus = useRef<ConnectionState>('connecting')
  const lastSentAt = useRef(0)
  const noticeSeq = useRef(0)
  const toastSeq = useRef(0)
  const timers = useRef(new Map<string, number>())
  const contents = useRef(new Map<string, string>())
  const nicknameRef = useRef('')

  const showToast = useCallback((text: string) => {
    toastSeq.current += 1
    setToast({ id: toastSeq.current, text })
  }, [])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(null), TOAST_MS)
    return () => window.clearTimeout(timer)
  }, [toast])

  const resetChat = useCallback(() => {
    for (const timer of timers.current.values()) window.clearTimeout(timer)
    timers.current.clear()
    contents.current.clear()
    dispatch({ type: 'reset' })
    setMembers([])
    setToast(null)
    setStatus('connecting')
    previousStatus.current = 'connecting'
    phaseRef.current = 'join'
    setPhase('join')
  }, [])

  const loadHistory = useCallback(async () => {
    setHistory('loading')
    try {
      const messages = await service.loadRecent()
      dispatch({ type: 'merge', messages })
      setHistory('ready')
    } catch {
      setHistory('error')
    }
  }, [service])

  // 訂閱聊天服務的事件
  useEffect(() => {
    return service.subscribe((event) => {
      switch (event.type) {
        case 'status': {
          const before = previousStatus.current
          previousStatus.current = event.state
          setStatus(event.state)
          // 斷線後恢復：把斷線期間漏掉的訊息補回來
          if (
            event.state === 'connected' &&
            (before === 'reconnecting' || before === 'offline') &&
            phaseRef.current === 'chat'
          ) {
            service
              .loadRecent()
              .then((messages) => dispatch({ type: 'merge', messages }))
              .catch(() => {
                // 補不回來就算了，之後的新訊息還是會即時進來
              })
          }
          break
        }
        case 'roster':
          setMembers(event.members)
          break
        case 'notice':
          if (phaseRef.current !== 'chat') break
          noticeSeq.current += 1
          dispatch({
            type: 'notice',
            id: `notice-${noticeSeq.current}`,
            notice: event.kind,
            nickname: event.nickname,
          })
          break
        case 'message': {
          if (phaseRef.current !== 'chat') break
          dispatch({ type: 'incoming', message: event.message })
          const timer = timers.current.get(event.message.id)
          if (timer !== undefined) {
            window.clearTimeout(timer)
            timers.current.delete(event.message.id)
          }
          contents.current.delete(event.message.id)
          break
        }
        case 'kicked':
          resetChat()
          setConnecting(false)
          setJoinError(JOIN_ERROR_TEXT.kicked)
          break
      }
    })
  }, [service, resetChat])

  const join = useCallback(
    async (raw: string) => {
      const name = normalizeNickname(raw)
      if (validateNickname(name) !== null) return

      setConnecting(true)
      setJoinError(null)
      setJoinHint(null)
      dispatch({ type: 'reset' })

      let attempt = 0
      for (;;) {
        try {
          await service.join(name)
          break
        } catch (error) {
          const code = errorCode(error)
          // 重新整理後，舊分頁的連線可能還沒被判定離開，所以代號是自己上次用的就多等一下
          if (
            code === 'NICKNAME_TAKEN' &&
            name === lastNickname &&
            attempt < OLD_CONNECTION_RETRIES
          ) {
            attempt += 1
            setJoinHint(JOIN_ERROR_TEXT.checkingOldConnection)
            await sleep(OLD_CONNECTION_RETRY_MS)
            continue
          }
          setJoinHint(null)
          setConnecting(false)
          if (code === 'NICKNAME_TAKEN') setJoinError(JOIN_ERROR_TEXT.taken)
          else if (code === 'NOT_CONNECTED') setJoinError(JOIN_ERROR_TEXT.offline)
          else setJoinError(JOIN_ERROR_TEXT.unknown)
          return
        }
      }

      writeString(NICKNAME_KEY, name)
      setLastNickname(name)
      nicknameRef.current = name
      setNickname(name)
      setJoinHint(null)
      setConnecting(false)
      phaseRef.current = 'chat'
      setPhase('chat')
      void loadHistory()
    },
    [service, lastNickname, loadHistory],
  )

  const leave = useCallback(() => {
    service.leave()
    resetChat()
    setJoinError(null)
  }, [service, resetChat])

  const clearJoinError = useCallback(() => setJoinError(null), [])

  const deliver = useCallback(
    (id: string, content: string) => {
      service
        .send(content, id)
        .then(() => {
          // 送出去了，但要等伺服器回傳同一則才算送達
          const timer = window.setTimeout(() => {
            timers.current.delete(id)
            dispatch({ type: 'timeout', id })
          }, DELIVERY_TIMEOUT_MS)
          timers.current.set(id, timer)
        })
        .catch(() => {
          dispatch({ type: 'delivery', id, delivery: 'failed' })
        })
    },
    [service],
  )

  const send = useCallback(
    (raw: string): boolean => {
      const content = normalizeMessage(raw)
      const problem = validateMessage(content)
      if (problem === 'MESSAGE_EMPTY') return false
      if (problem) {
        showToast(SEND_ERROR_TEXT[problem] ?? SEND_ERROR_TEXT.SEND_FAILED!)
        return false
      }
      if (previousStatus.current !== 'connected') {
        showToast(SEND_ERROR_TEXT.NOT_CONNECTED!)
        return false
      }
      const now = Date.now()
      if (!canSendNow(lastSentAt.current, now)) {
        showToast(SEND_ERROR_TEXT.RATE_LIMITED!)
        return false
      }
      lastSentAt.current = now

      const message: Message = {
        id: newId(),
        nickname: nicknameRef.current,
        content,
        createdAt: new Date(now).toISOString(),
      }
      contents.current.set(message.id, content)
      dispatch({ type: 'pending', message })
      deliver(message.id, content)
      return true
    },
    [deliver, showToast],
  )

  const retry = useCallback(
    (id: string) => {
      const content = contents.current.get(id)
      if (content === undefined) return
      dispatch({ type: 'delivery', id, delivery: 'sending' })
      deliver(id, content)
    },
    [deliver],
  )

  const reloadHistory = useCallback(() => {
    void loadHistory()
  }, [loadHistory])

  return {
    phase,
    nickname,
    lastNickname,
    connecting,
    joinError,
    joinHint,
    status,
    members,
    items,
    history,
    toast: toast?.text ?? null,
    join,
    leave,
    clearJoinError,
    send,
    retry,
    reloadHistory,
    showToast,
  }
}
