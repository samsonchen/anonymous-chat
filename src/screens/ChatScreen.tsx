import { useCallback, useEffect, useRef, useState } from 'react'
import { ConnectionBanner } from '../components/ConnectionBanner'
import { Composer } from '../components/Composer'
import { DemoBanner } from '../components/DemoBanner'
import { MessageList } from '../components/MessageList'
import { OnlineList } from '../components/OnlineList'
import { TopBar } from '../components/TopBar'
import { SEND_ERROR_TEXT } from '../chat/copy'
import type { ChatApi } from '../hooks/useChat'

export function ChatScreen({ chat }: { chat: ChatApi }) {
  // 手機的上線名單抽屜。電腦版名單固定在側邊，不受這個影響
  const [listOpen, setListOpen] = useState(false)
  const closeList = useCallback(() => setListOpen(false), [])
  const toggleList = useCallback(() => setListOpen((open) => !open), [])

  // 抽屜關閉後，把焦點還給「N 人在線」按鈕
  const wasOpen = useRef(false)
  useEffect(() => {
    if (wasOpen.current && !listOpen) {
      document.querySelector<HTMLElement>('.topbar__pill')?.focus()
    }
    wasOpen.current = listOpen
  }, [listOpen])

  return (
    <div className="chat">
      <DemoBanner />
      <TopBar
        onlineCount={chat.members.length}
        listOpen={listOpen}
        onToggleList={toggleList}
        onLeave={chat.leave}
      />
      <ConnectionBanner status={chat.status} />
      <div className="chat__body">
        <main className="chat__main">
          <MessageList
            items={chat.items}
            nickname={chat.nickname}
            history={chat.history}
            onReloadHistory={chat.reloadHistory}
            onRetry={chat.retry}
          />
          <Composer
            disabled={chat.status !== 'connected'}
            toast={chat.toast}
            onSend={chat.send}
            onOverflow={() => chat.showToast(SEND_ERROR_TEXT.MESSAGE_TOO_LONG!)}
          />
        </main>
        <OnlineList
          members={chat.members}
          selfNickname={chat.nickname}
          open={listOpen}
          onClose={closeList}
        />
      </div>
    </div>
  )
}
