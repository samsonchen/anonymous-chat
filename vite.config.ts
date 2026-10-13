import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages 的網址是 https://<帳號>.github.io/<repo 名稱>/，
// 所以網站必須知道自己在 /<repo 名稱>/ 底下，否則會找不到 JavaScript 和 CSS。
// 本機開發也用同一個路徑，這樣路徑出錯時在本機就會看到。
// repo 改名時，只要改這一行。
const REPO_NAME = 'anonymous-chat'

export default defineConfig({
  base: `/${REPO_NAME}/`,
  plugins: [react()],
})
