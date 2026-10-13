import { LogOutIcon } from './icons'

interface Props {
  onlineCount: number
  listOpen: boolean
  onToggleList: () => void
  onLeave: () => void
}

export function TopBar({ onlineCount, listOpen, onToggleList, onLeave }: Props) {
  return (
    <header className="topbar">
      <h1 className="topbar__title">匿名聊天室</h1>

      {/* 手機：按下打開上線名單 */}
      <button
        type="button"
        className="topbar__pill"
        aria-expanded={listOpen}
        aria-controls="online-list"
        aria-label={`上線名單，${onlineCount} 人在線`}
        onClick={onToggleList}
      >
        <span className="dot" aria-hidden="true" />
        {onlineCount} 人在線
      </button>

      {/* 電腦：名單固定在側邊，這裡只是文字 */}
      <span className="topbar__count">
        <span className="dot" aria-hidden="true" />
        {onlineCount} 人在線
      </span>

      <button type="button" className="topbar__leave" onClick={onLeave}>
        <LogOutIcon />
        <span>離開</span>
      </button>
    </header>
  )
}
