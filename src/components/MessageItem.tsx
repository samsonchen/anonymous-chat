import type { Delivery } from '../hooks/timeline'
import type { Message } from '../chat/types'
import { AlertIcon, CheckIcon, RefreshIcon, SpinnerIcon } from './icons'

interface Props {
  message: Message
  own: boolean
  delivery?: Delivery
  onRetry: (id: string) => void
}

function formatTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const hh = String(date.getHours()).padStart(2, '0')
  const mm = String(date.getMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}

function DeliveryLabel({ delivery }: { delivery: Delivery }) {
  if (delivery === 'sending') {
    return (
      <span className="msg__status msg__status--sending">
        <SpinnerIcon size={12} strokeWidth={3} />
        送出中
      </span>
    )
  }
  if (delivery === 'sent') {
    return (
      <span className="msg__status msg__status--sent">
        <CheckIcon size={12} strokeWidth={3} />
        已送達
      </span>
    )
  }
  return (
    <span className="msg__status msg__status--failed">
      <AlertIcon size={12} strokeWidth={2.5} />
      送出失敗
    </span>
  )
}

export function MessageItem({ message, own, delivery, onRetry }: Props) {
  const classes = ['msg', own ? 'msg--own' : 'msg--other']
  if (delivery) classes.push(`msg--${delivery}`)

  return (
    <div className={classes.join(' ')}>
      <div className="msg__meta">
        {own ? (
          <>
            {delivery && <DeliveryLabel delivery={delivery} />}
            <span className="msg__time">{formatTime(message.createdAt)}</span>
          </>
        ) : (
          <>
            <span className="msg__name">{message.nickname}</span>
            <span className="msg__time">{formatTime(message.createdAt)}</span>
          </>
        )}
      </div>
      {/* 一律當純文字顯示。React 預設就會跳脫，專案內不使用 dangerouslySetInnerHTML */}
      <div className="msg__bubble">{message.content}</div>
      {delivery === 'failed' && (
        <button type="button" className="msg__retry" onClick={() => onRetry(message.id)}>
          <RefreshIcon />
          重送
        </button>
      )}
    </div>
  )
}
