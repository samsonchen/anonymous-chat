import { isDemoMode } from '../chat/createChatService'
import { InfoIcon } from './icons'

/** 階段一的固定提示。接上 Supabase（VITE_CHAT_BACKEND=supabase）後自動消失 */
export function DemoBanner() {
  if (!isDemoMode()) return null
  return (
    <div className="demo-banner" role="note">
      <InfoIcon />
      <span>展示模式：訊息只存在你的瀏覽器，別人看不到。</span>
    </div>
  )
}
