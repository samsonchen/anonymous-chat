import { useEffect } from 'react'

/**
 * 手機的虛擬鍵盤跳出來時，把畫面高度縮成「鍵盤上方看得到的範圍」，
 * 輸入框才不會被鍵盤蓋住。沒有 visualViewport 的瀏覽器就用 CSS 的 100dvh。
 */
export function useViewportHeight(): void {
  useEffect(() => {
    const viewport = window.visualViewport
    if (!viewport) return

    const root = document.documentElement
    const update = () => {
      root.style.setProperty('--app-height', `${viewport.height}px`)
    }
    // iOS 鍵盤跳出時會把整個網頁往上推，推回來
    const resetScroll = () => window.scrollTo(0, 0)

    update()
    viewport.addEventListener('resize', update)
    viewport.addEventListener('scroll', resetScroll)
    return () => {
      viewport.removeEventListener('resize', update)
      viewport.removeEventListener('scroll', resetScroll)
      root.style.removeProperty('--app-height')
    }
  }, [])
}
