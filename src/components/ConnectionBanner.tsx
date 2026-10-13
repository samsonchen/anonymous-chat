import type { ConnectionState } from '../chat/types'
import { AlertIcon, RefreshIcon, SpinnerIcon } from './icons'

/** 連線狀態列：只在不正常時出現 */
export function ConnectionBanner({ status }: { status: ConnectionState }) {
  if (status === 'connected') return null

  if (status === 'connecting') {
    return (
      <div className="conn conn--connecting" role="status">
        <SpinnerIcon />
        <span className="conn__text">連線中…</span>
      </div>
    )
  }

  if (status === 'reconnecting') {
    return (
      <div className="conn conn--reconnecting" role="status">
        <AlertIcon />
        <span className="conn__text">連線中斷，重新連線中…</span>
      </div>
    )
  }

  return (
    <div className="conn conn--offline" role="alert">
      <AlertIcon />
      <span className="conn__text">無法連線</span>
      <button type="button" className="conn__button" onClick={() => window.location.reload()}>
        <RefreshIcon />
        重新整理
      </button>
    </div>
  )
}
