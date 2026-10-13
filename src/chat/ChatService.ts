import type { ChatEvent, Message } from './types'

/**
 * 聊天服務介面。畫面只對這份合約說話，不知道背後是模擬版還是 Supabase。
 * 階段一：MockChatService。階段二：SupabaseChatService。
 */
export interface ChatService {
  /** 用這個代號進入聊天室。失敗時丟出 ChatError（NICKNAME_INVALID、NICKNAME_TAKEN、NOT_CONNECTED） */
  join(nickname: string): Promise<void>

  /** 離開聊天室 */
  leave(): void

  /**
   * 送出一則訊息。id 由呼叫端產生，這樣畫面可以先顯示「送出中」，
   * 之後收到同一個 id 的 message 事件就知道已送達。
   * 同一個 id 重送必須是安全的（不會出現兩則）。
   * 失敗時丟出 ChatError（MESSAGE_EMPTY、MESSAGE_TOO_LONG、NOT_CONNECTED、SEND_FAILED）
   */
  send(content: string, id: string): Promise<void>

  /** 取得最近 100 則，由舊到新。失敗時丟出 ChatError（LOAD_FAILED） */
  loadRecent(): Promise<Message[]>

  /** 訂閱事件，回傳取消訂閱的函式 */
  subscribe(listener: (event: ChatEvent) => void): () => void
}
