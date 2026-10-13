// 瀏覽器的小儲存空間（localStorage）。無痕模式或被封鎖時會丟錯，所以每次讀寫都包 try/catch，
// 讀不到就當作沒有，網站照常運作。

export function readString(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

export function writeString(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // 寫不進去就算了
  }
}

export function readJSON<T>(key: string, fallback: T): T {
  const raw = readString(key)
  if (raw === null) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export function writeJSON(key: string, value: unknown): void {
  writeString(key, JSON.stringify(value))
}
