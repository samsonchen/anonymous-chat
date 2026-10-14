import type { ChatService } from './ChatService'
import { MockChatService } from './MockChatService'
import { SupabaseChatService } from './SupabaseChatService'

/**
 * 整個專案只有這個檔案知道有兩個版本的聊天服務。
 * 由 VITE_CHAT_BACKEND 決定：mock（模擬版，預設）或 supabase。
 */
function createChatService(): ChatService {
  const backend = import.meta.env.VITE_CHAT_BACKEND ?? 'mock'
  if (backend === 'mock') return new MockChatService()
  if (backend === 'supabase') {
    const url = import.meta.env.VITE_SUPABASE_URL
    const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
    if (!url || !key) {
      throw new Error(
        'VITE_CHAT_BACKEND=supabase 需要 VITE_SUPABASE_URL 和 VITE_SUPABASE_PUBLISHABLE_KEY。本機放在 .env.local，部署放在 GitHub 的 Variables。',
      )
    }
    return new SupabaseChatService(url, key)
  }
  throw new Error(`不認得的 VITE_CHAT_BACKEND：${backend}（只能是 mock 或 supabase）`)
}

let instance: ChatService | null = null

/** 整個網頁共用同一個聊天服務 */
export function getChatService(): ChatService {
  instance ??= createChatService()
  return instance
}

/** 目前是不是展示模式（模擬版）。接上 Supabase 後，展示模式提示會跟著消失 */
export function isDemoMode(): boolean {
  return (import.meta.env.VITE_CHAT_BACKEND ?? 'mock') === 'mock'
}
