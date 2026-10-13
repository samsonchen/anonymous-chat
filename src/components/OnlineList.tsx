import { useEffect, useMemo, useRef } from 'react'
import type { Member } from '../chat/types'
import { CloseIcon } from './icons'

interface Props {
  members: Member[]
  selfNickname: string
  /** 只影響手機（抽屜）。電腦版永遠固定顯示在側邊 */
  open: boolean
  onClose: () => void
}

export function OnlineList({ members, selfNickname, open, onClose }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null)

  // 自己排最上面，其他人依進入時間
  const sorted = useMemo(() => {
    const others = members.filter((m) => m.nickname !== selfNickname)
    const self = members.filter((m) => m.nickname === selfNickname)
    return [...self, ...others]
  }, [members, selfNickname])

  // 抽屜打開時，把焦點移到關閉按鈕，並可以按 Esc 關閉
  useEffect(() => {
    if (!open) return
    closeRef.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  return (
    <>
      <button
        type="button"
        className="online__backdrop"
        data-open={open}
        aria-label="關閉上線名單"
        tabIndex={open ? 0 : -1}
        onClick={onClose}
      />
      <aside id="online-list" className="online" data-open={open} aria-label="上線名單">
        <div className="online__head">
          <h2 className="online__title">
            在線 <span className="mono">{members.length}</span>
          </h2>
          <button
            ref={closeRef}
            type="button"
            className="online__close"
            aria-label="關閉"
            onClick={onClose}
          >
            <CloseIcon size={22} />
          </button>
        </div>
        <ul className="online__list">
          {sorted.map((member) => {
            const isSelf = member.nickname === selfNickname
            return (
              <li key={member.clientId} className={isSelf ? 'online__item online__item--self' : 'online__item'}>
                <span className="dot dot--online" aria-hidden="true" />
                <span className="online__name">
                  {member.nickname}
                  {isSelf && <span className="online__you">（你）</span>}
                </span>
              </li>
            )
          })}
        </ul>
      </aside>
    </>
  )
}
