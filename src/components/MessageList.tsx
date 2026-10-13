import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { HistoryState } from '../hooks/useChat'
import type { TimelineItem } from '../hooks/timeline'
import { ArrowDownIcon } from './icons'
import { MessageItem } from './MessageItem'
import { SystemNotice } from './SystemNotice'

interface Props {
  items: TimelineItem[]
  nickname: string
  history: HistoryState
  onReloadHistory: () => void
  onRetry: (id: string) => void
}

/** 離底部多近，算「停在最底部」 */
const NEAR_BOTTOM_PX = 48

export function MessageList({ items, nickname, history, onReloadHistory, onRetry }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const stuckToBottom = useRef(true)
  const lastId = useRef<string | null>(null)
  const [hasNew, setHasNew] = useState(false)

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
    stuckToBottom.current = true
    setHasNew(false)
  }, [])

  const handleScroll = () => {
    const el = scrollRef.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX
    stuckToBottom.current = atBottom
    if (atBottom) setHasNew(false)
  }

  // 有新項目時：停在最底部（或是自己剛送出）就捲到底；正在往上看舊訊息就不拉走，改出現「有新訊息」
  useLayoutEffect(() => {
    const last = items[items.length - 1]
    const key = last?.id ?? null
    const changed = key !== lastId.current
    lastId.current = key

    const justSentByMe = changed && last?.kind === 'message' && last.delivery === 'sending'
    if (stuckToBottom.current || justSentByMe) scrollToBottom()
    else if (changed && last?.kind === 'message') setHasNew(true)
  }, [items, scrollToBottom])

  // 手機鍵盤跳出、視窗縮放時，如果原本在最底部，就維持在最底部
  useEffect(() => {
    const el = scrollRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      if (stuckToBottom.current) el.scrollTop = el.scrollHeight
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return (
    <section className="list" aria-label="訊息列表">
      <div ref={scrollRef} className="list__scroll" onScroll={handleScroll} role="log" aria-live="polite">
        <div className="list__inner">
          {history === 'error' && (
            <div className="list__error" role="alert">
              <span>無法載入歷史訊息</span>
              <button type="button" className="button button--outline" onClick={onReloadHistory}>
                重試
              </button>
            </div>
          )}
          {history === 'loading' && items.length === 0 && (
            <div className="list__empty">載入歷史訊息…</div>
          )}
          {history === 'ready' && items.length === 0 && <div className="list__empty">還沒有訊息</div>}

          {items.map((item) =>
            item.kind === 'notice' ? (
              <SystemNotice key={item.id} notice={item.notice} nickname={item.nickname} />
            ) : (
              <MessageItem
                key={item.id}
                message={item.message}
                own={item.message.nickname === nickname}
                delivery={item.delivery}
                onRetry={onRetry}
              />
            ),
          )}
        </div>
      </div>

      {hasNew && (
        <button type="button" className="list__new" onClick={scrollToBottom}>
          <ArrowDownIcon strokeWidth={2.5} />
          有新訊息
        </button>
      )}
    </section>
  )
}
