// 訊息列表裡的項目（訊息 + 進出提示）和更新它們的規則。純函式，沒有畫面。

import type { Message } from '../chat/types'

export type Delivery = 'sending' | 'sent' | 'failed'

export type TimelineItem =
  | {
      kind: 'message'
      id: string
      message: Message
      /** 只有「這次進來之後自己送出的訊息」才有；歷史訊息和別人的訊息沒有 */
      delivery?: Delivery
    }
  | { kind: 'notice'; id: string; notice: 'join' | 'leave'; nickname: string }

export type TimelineAction =
  | { type: 'reset' }
  | { type: 'merge'; messages: Message[] }
  | { type: 'incoming'; message: Message }
  | { type: 'notice'; id: string; notice: 'join' | 'leave'; nickname: string }
  | { type: 'pending'; message: Message }
  | { type: 'delivery'; id: string; delivery: Delivery }
  | { type: 'timeout'; id: string }

/** 最多保留幾項，避免聊太久記憶體一直長 */
const MAX_ITEMS = 500

function isAfter(a: Message, b: Message): boolean {
  if (a.createdAt !== b.createdAt) return a.createdAt > b.createdAt
  return a.id > b.id
}

function hasMessage(items: TimelineItem[], id: string): boolean {
  return items.some((item) => item.kind === 'message' && item.id === id)
}

function trim(items: TimelineItem[]): TimelineItem[] {
  return items.length > MAX_ITEMS ? items.slice(items.length - MAX_ITEMS) : items
}

/** 把歷史或補抓回來的訊息放進列表：已經有的跳過，沒有的依時間插進正確位置 */
function mergeMessages(items: TimelineItem[], incoming: Message[]): TimelineItem[] {
  const result = [...items]
  const sorted = [...incoming].sort((a, b) => (isAfter(a, b) ? 1 : -1))
  for (const message of sorted) {
    if (hasMessage(result, message.id)) continue
    const at = result.findIndex((item) => item.kind === 'message' && isAfter(item.message, message))
    const entry: TimelineItem = { kind: 'message', id: message.id, message }
    if (at === -1) result.push(entry)
    else result.splice(at, 0, entry)
  }
  return trim(result)
}

export function timelineReducer(items: TimelineItem[], action: TimelineAction): TimelineItem[] {
  switch (action.type) {
    case 'reset':
      return []

    case 'merge':
      return mergeMessages(items, action.messages)

    case 'incoming': {
      const { message } = action
      // 自己送出的訊息收到回傳：換成伺服器的版本，並標示已送達
      if (hasMessage(items, message.id)) {
        return items.map((item) =>
          item.kind === 'message' && item.id === message.id
            ? { ...item, message, delivery: item.delivery ? 'sent' : undefined }
            : item,
        )
      }
      return trim([...items, { kind: 'message', id: message.id, message }])
    }

    case 'notice':
      return trim([
        ...items,
        { kind: 'notice', id: action.id, notice: action.notice, nickname: action.nickname },
      ])

    case 'pending':
      return trim([
        ...items,
        { kind: 'message', id: action.message.id, message: action.message, delivery: 'sending' },
      ])

    case 'delivery':
      return items.map((item) =>
        item.kind === 'message' && item.id === action.id
          ? { ...item, delivery: action.delivery }
          : item,
      )

    case 'timeout':
      // 太久沒收到回傳，仍在「送出中」的才算失敗
      return items.map((item) =>
        item.kind === 'message' && item.id === action.id && item.delivery === 'sending'
          ? { ...item, delivery: 'failed' }
          : item,
      )
  }
}
