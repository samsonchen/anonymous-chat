import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { NICKNAME_PROBLEM_TEXT } from '../chat/copy'
import {
  NICKNAME_MAX,
  charCount,
  normalizeNickname,
  truncateChars,
  validateNickname,
} from '../chat/validation'
import { AlertIcon, ChatBubbleIcon, InfoIcon, SpinnerIcon } from '../components/icons'
import { DemoBanner } from '../components/DemoBanner'

interface Props {
  /** 預先填入上次使用的代號（沒有就是空的） */
  initialNickname: string
  connecting: boolean
  /** 伺服器端的錯誤：代號已被使用、被踢出、連不上 */
  error: string | null
  hint: string | null
  onSubmit: (nickname: string) => void
  onEdit: () => void
}

export function JoinScreen({ initialNickname, connecting, error, hint, onSubmit, onEdit }: Props) {
  const [value, setValue] = useState(initialNickname)
  const inputRef = useRef<HTMLInputElement>(null)

  // 進來時游標放在輸入框最後面
  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  }, [])

  const nickname = normalizeNickname(value)
  const problem = validateNickname(nickname)
  // 「還沒輸入」不算錯誤，只是按鈕按不了
  const formatError = problem && problem !== 'empty' ? NICKNAME_PROBLEM_TEXT[problem] : null
  const shownError = formatError ?? error
  const canSubmit = problem === null && !connecting

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    setValue(truncateChars(event.target.value, NICKNAME_MAX))
    onEdit()
  }

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    if (canSubmit) onSubmit(nickname)
  }

  return (
    <div className="join">
      <DemoBanner />
      <main className="join__main">
        <form className="join__card" onSubmit={handleSubmit} noValidate>
          <div className="join__intro">
            <div className="join__mark">
              <ChatBubbleIcon size={26} />
            </div>
            <h1 className="join__title">匿名聊天室</h1>
            <p className="join__lead">不用註冊、不用登入。取一個代號就能進來，所有人都在同一間。</p>
          </div>

          <div className="join__field">
            <label htmlFor="nickname" className="join__label">
              你的代號
            </label>
            <input
              ref={inputRef}
              id="nickname"
              className="join__input"
              type="text"
              value={value}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              disabled={connecting}
              aria-invalid={shownError ? true : undefined}
              aria-describedby={shownError || hint ? 'join-message' : 'join-help'}
              onChange={handleChange}
            />
            <div className="join__meta" id="join-help">
              <span>1–{NICKNAME_MAX} 個字，前後空白會自動去掉</span>
              <span className="mono">
                {charCount(nickname)} / {NICKNAME_MAX}
              </span>
            </div>

            {/* 這一區固定保留一行高度，出現錯誤時畫面才不會跳動 */}
            <div id="join-message" className="join__message">
              {shownError ? (
                <div className="join__error" role="alert">
                  <AlertIcon />
                  <span>{shownError}</span>
                </div>
              ) : hint ? (
                <div className="join__hint" role="status">
                  <InfoIcon />
                  <span>{hint}</span>
                </div>
              ) : null}
            </div>

            <button type="submit" className="join__submit" disabled={!canSubmit} aria-busy={connecting}>
              {connecting ? (
                <>
                  <SpinnerIcon size={20} strokeWidth={2.5} />
                  連線中…
                </>
              ) : (
                '進入聊天室'
              )}
            </button>
          </div>
        </form>
      </main>
    </div>
  )
}
