// 這個檔案是「通訊約定」（docs/architecture.md 第 5 段）。
// 畫面和兩個版本的聊天服務（模擬版、Supabase 版）都只認這裡的格式。

/** 一則訊息 */
export interface Message {
  /** 瀏覽器送出時產生的 UUID。收到伺服器回傳同一個 id，就知道自己那則已送達 */
  id: string
  /** 送出者的代號，1–12 字 */
  nickname: string
  /** 訊息內容，1–500 字 */
  content: string
  /** ISO 8601（UTC）。階段二由資料庫填寫，階段一由模擬版填寫 */
  createdAt: string
}

/** 一位在線上的人（Presence 登記的資料） */
export interface Member {
  nickname: string
  /** 每個瀏覽器分頁各自產生一個，代號搶輸贏時用來比先後 */
  clientId: string
  joinedAt: string
}

export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'offline'

/** 固定的錯誤代碼。畫面只看代碼，不看底層錯誤訊息 */
export type ErrorCode =
  | 'NICKNAME_INVALID'
  | 'NICKNAME_TAKEN'
  | 'MESSAGE_EMPTY'
  | 'MESSAGE_TOO_LONG'
  | 'RATE_LIMITED'
  | 'NOT_CONNECTED'
  | 'SEND_FAILED'
  | 'LOAD_FAILED'

export class ChatError extends Error {
  readonly code: ErrorCode

  constructor(code: ErrorCode) {
    super(code)
    this.name = 'ChatError'
    this.code = code
  }
}

/** 聊天服務通知畫面的事件 */
export type ChatEvent =
  | { type: 'status'; state: ConnectionState }
  | { type: 'roster'; members: Member[] }
  | { type: 'notice'; kind: 'join' | 'leave'; nickname: string; at: string }
  | { type: 'message'; message: Message }
  | { type: 'kicked'; reason: 'nickname-conflict' }
