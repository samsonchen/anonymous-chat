import { useLayoutEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react'
import { MESSAGE_MAX, charCount, truncateChars } from '../chat/validation'
import { AlertIcon, ArrowUpIcon } from './icons'

interface Props {
  /** 連線不正常時為 true：可以打字，但不能送出 */
  disabled: boolean
  toast: string | null
  /** 回傳 true 代表訊息已受理，輸入框可以清空 */
  onSend: (raw: string) => boolean
  /** 貼上或輸入超過字數上限時 */
  onOverflow: () => void
}

/** 剩幾個字以內才顯示「已輸入 / 500」 */
const SHOW_COUNT_REMAINING = 50

export function Composer({ disabled, toast, onSend, onOverflow }: Props) {
  const [text, setText] = useState('')
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const count = charCount(text)
  const canSend = !disabled && text.trim().length > 0

  // 輸入框隨內容長高（有最大高度，超過就捲動）
  useLayoutEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    const border = el.offsetHeight - el.clientHeight
    el.style.height = `${el.scrollHeight + border}px`
  }, [text])

  const handleChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    let value = event.target.value
    if (charCount(value) > MESSAGE_MAX) {
      value = truncateChars(value, MESSAGE_MAX)
      onOverflow()
    }
    setText(value)
  }

  const submit = () => {
    if (disabled) return
    if (onSend(text)) {
      setText('')
      inputRef.current?.focus()
    }
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey) return
    // 正在用注音、拼音等輸入法選字時，Enter 是確認選字，不是送出
    if (event.nativeEvent.isComposing || event.keyCode === 229) return
    // 手機（觸控）：Enter 換行，用按鈕送出。電腦：Enter 送出，Shift+Enter 換行
    if (window.matchMedia('(pointer: coarse)').matches) return
    event.preventDefault()
    submit()
  }

  return (
    <div className="composer">
      {toast && (
        <div className="composer__toast" role="alert">
          <AlertIcon />
          <span>{toast}</span>
        </div>
      )}
      <div className="composer__row">
        <textarea
          ref={inputRef}
          className="composer__input"
          aria-label="輸入訊息"
          placeholder="輸入訊息…"
          rows={1}
          value={text}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
        />
        <button
          type="button"
          className="composer__send"
          disabled={!canSend}
          // 按下按鈕時不要搶走輸入框的焦點，手機鍵盤才不會收起來
          onMouseDown={(event) => event.preventDefault()}
          onClick={submit}
        >
          <ArrowUpIcon strokeWidth={2.5} />
          送出
        </button>
      </div>
      <div className="composer__foot">
        <span className="composer__hint">Enter 送出，Shift+Enter 換行</span>
        {count >= MESSAGE_MAX - SHOW_COUNT_REMAINING && (
          <span className={count >= MESSAGE_MAX ? 'composer__count composer__count--full' : 'composer__count'}>
            已輸入 {count} / {MESSAGE_MAX}
          </span>
        )}
      </div>
    </div>
  )
}
