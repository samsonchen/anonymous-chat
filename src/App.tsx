import { useChat } from './hooks/useChat'
import { useViewportHeight } from './hooks/useViewportHeight'
import { ChatScreen } from './screens/ChatScreen'
import { JoinScreen } from './screens/JoinScreen'

export default function App() {
  const chat = useChat()
  useViewportHeight()

  if (chat.phase === 'join') {
    return (
      <JoinScreen
        initialNickname={chat.lastNickname}
        connecting={chat.connecting}
        error={chat.joinError}
        hint={chat.joinHint}
        onSubmit={chat.join}
        onEdit={chat.clearJoinError}
      />
    )
  }

  return <ChatScreen chat={chat} />
}
