// 畫面上會出現的錯誤與提示文字，集中放在這裡。
import type { ErrorCode } from './types'
import type { NicknameProblem } from './validation'

export const NICKNAME_PROBLEM_TEXT: Record<Exclude<NicknameProblem, 'empty'>, string> = {
  'too-long': '代號最多 12 個字。',
  'forbidden-char': '代號不能包含看不見的字元。',
  reserved: '這個代號保留給系統使用，請換一個。',
}

export const JOIN_ERROR_TEXT = {
  taken: '這個代號已被使用，請換一個。',
  kicked: '你的代號被別人先用了，請換一個代號再進來。',
  offline: '目前連不上聊天室，請檢查網路後再試一次。',
  unknown: '進不去聊天室，請再試一次。',
  checkingOldConnection: '正在確認舊連線是否已結束…',
}

export const SEND_ERROR_TEXT: Partial<Record<ErrorCode, string>> = {
  MESSAGE_TOO_LONG: '訊息最多 500 字，請縮短一點',
  RATE_LIMITED: '請稍等一下再送',
  NOT_CONNECTED: '目前沒有連線，等連線恢復後再送',
  SEND_FAILED: '送出失敗，請再試一次',
}
