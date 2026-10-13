import type { ChatService } from './ChatService'
import { MockChatService } from './MockChatService'

/**
 * 整個專案只有這個檔案知道有兩個版本的聊天服務。
 * 階段二：新增 SupabaseChatService，在下面多一個 'supabase' 分支，並把
 * VITE_CHAT_BACKEND 設成 supabase。畫面不用改。
 */
function createChatService(): ChatService {
  const backend = import.meta.env.VITE_CHAT_BACKEND ?? 'mock'
  if (backend === 'mock') return new MockChatService()
  throw new Error(
    `VITE_CHAT_BACKEND=${backend} 還沒有實作。階段一只能用 mock，Supabase 版要到階段二才會加上。`,
  )
}

let instance: ChatService | null = null

/** 整個網頁共用同一個聊天服務 */
export function getChatService(): ChatService {
  instance ??= createChatService()
  return instance
}

/** 目前是不是展示模式（模擬版）。階段二接上 Supabase 後，展示模式提示會跟著消失 */
export function isDemoMode(): boolean {
  return (import.meta.env.VITE_CHAT_BACKEND ?? 'mock') === 'mock'
}
