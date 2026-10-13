// 代號與訊息的檢查規則。兩個版本的聊天服務和畫面共用，所以規則只會有一份。
// 這些檢查是為了給使用者好的提示，不能當作安全防線（見 docs/architecture.md 第 9 段）。

export const NICKNAME_MAX = 12
export const MESSAGE_MAX = 500
/** 進入時載入、補抓時最多取回的訊息數 */
export const RECENT_LIMIT = 100
/** 同一個人兩則訊息之間至少要隔多久 */
export const SEND_INTERVAL_MS = 1000
/** 保留給系統提示用，不能當代號 */
const RESERVED_NICKNAMES = ['系統', 'system']

// 看不見的字元：控制字元、零寬字元、文字方向控制字元。
// 刻意不包含 U+200C、U+200D，否則組合表情符號（例如家庭）會壞掉。
// 用數字範圍判斷，不用正規表示式，原始碼裡就不會出現看不見的字元。
const INVISIBLE_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x0000, 0x0008], // 控制字元（Tab、換行由 normalizeMessage 另外處理）
  [0x000b, 0x001f],
  [0x007f, 0x009f],
  [0x00ad, 0x00ad], // 軟連字號
  [0x200b, 0x200b], // 零寬空白
  [0x200e, 0x200f], // 文字方向標記
  [0x2028, 0x202e], // 行分隔、段分隔、文字方向的嵌入與覆蓋
  [0x2060, 0x206f], // 單詞連接、隱形運算子、文字方向隔離
  [0xfeff, 0xfeff], // 位元組順序標記
  [0xfff9, 0xfffb], // 註解錨點
]

function isInvisible(char: string): boolean {
  const code = char.codePointAt(0) ?? 0
  return INVISIBLE_RANGES.some(([from, to]) => code >= from && code <= to)
}

function hasInvisible(text: string): boolean {
  for (const char of text) if (isInvisible(char)) return true
  return false
}

/** 用使用者看到的「字」計算長度（一個表情符號算一個字） */
export function charCount(text: string): number {
  return Array.from(text).length
}

export function truncateChars(text: string, max: number): string {
  const chars = Array.from(text)
  return chars.length > max ? chars.slice(0, max).join('') : text
}

export function normalizeNickname(raw: string): string {
  return raw.trim()
}

/** 比對代號是否重複時用：全形半形、大小寫視為相同 */
export function nicknameKey(nickname: string): string {
  return nickname.normalize('NFKC').toLowerCase()
}

export type NicknameProblem = 'empty' | 'too-long' | 'forbidden-char' | 'reserved'

export function validateNickname(nickname: string): NicknameProblem | null {
  if (nickname.length === 0) return 'empty'
  if (charCount(nickname) > NICKNAME_MAX) return 'too-long'
  if (hasInvisible(nickname)) return 'forbidden-char'
  if (RESERVED_NICKNAMES.includes(nicknameKey(nickname))) return 'reserved'
  return null
}

/** 訊息送出前的整理：移除看不見的字元、統一換行、連續空行只留一行、去掉前後空白 */
export function normalizeMessage(raw: string): string {
  const cleaned = Array.from(raw.replace(/\r\n?/g, '\n').replace(/\t/g, ' '))
    .filter((ch) => !isInvisible(ch))
    .join('')
  return cleaned
    .replace(/[ ]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function validateMessage(content: string): 'MESSAGE_EMPTY' | 'MESSAGE_TOO_LONG' | null {
  if (content.length === 0) return 'MESSAGE_EMPTY'
  if (charCount(content) > MESSAGE_MAX) return 'MESSAGE_TOO_LONG'
  return null
}

/** 距離上一則是否已經夠久，可以再送 */
export function canSendNow(lastSentAt: number, now: number): boolean {
  return now - lastSentAt >= SEND_INTERVAL_MS
}
