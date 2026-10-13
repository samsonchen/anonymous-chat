# 匿名聊天室

不用登入的匿名聊天室，所有人在同一間。網頁放 GitHub Pages，即時傳訊用 Supabase。

目前在**階段一**：只有前端，聊天內容由「模擬版」處理，訊息只存在自己的瀏覽器裡。階段二才接上 Supabase。

完整說明請看：

- `docs/requirements.md`：需求
- `docs/architecture.md`：架構
- `docs/design.md`：畫面設計

## 在自己的電腦上跑

需要 Node.js（已安裝的版本 22 以上即可）。

```
npm install       # 第一次，或套件有變動時
npm run dev       # 啟動預覽
```

打開 <http://localhost:5173/anonymous-chat/>（網址最後的 `/anonymous-chat/` 要有）。

其他指令：

```
npm run build     # 檢查型別並打包成 dist/，要沒有錯誤才算通過
npm run preview   # 預覽打包後的版本，和 GitHub Pages 上看到的一樣
```

## 測試方法（階段一）

階段一沒有伺服器，所以「開兩個瀏覽器分頁」就等於兩個人。

| 想測什麼 | 怎麼做 |
|---|---|
| 一個人也想看到熱鬧的畫面 | 網址後面加 `?demo=1`，會有幾個假的在線者定期說話、進出 |
| 兩個人互相聊天 | 開兩個分頁，各用不同代號進入 |
| 代號重複 | 分頁 A 已在聊天室，分頁 B 用同一個代號 |
| 重新整理 | 在聊天室按 F5：回到進入畫面，代號已填好，按一下就能進 |
| 送太快 | 連續快速按 Enter 送兩則，第二則會被擋下並提示 |
| 超過 500 字 | 貼一大段文字進輸入框 |
| 斷線 | 瀏覽器開發者工具（F12）→ Network → 切成 Offline，再切回來 |
| 載入歷史失敗 | 網址後面加 `?fail=history`，進入後會看到「重試」 |
| 送出失敗 | 網址後面加 `?fail=send`，送第一則會失敗並出現「重送」 |
| 手機版面 | 瀏覽器開發者工具 → 切換裝置模式（Ctrl+Shift+M），或用手機連同一個 Wi-Fi，打開 `npm run dev` 顯示的 Network 網址 |

測試網址參數可以合併，例如 `?demo=1&fail=history,send`。這些參數只有模擬版有。

要清除測試資料：開發者工具 → Application → Local Storage → 刪掉 `anonymous-chat:` 開頭的項目。

## 程式怎麼分

```
src/
├─ chat/        聊天服務。畫面只認 ChatService 這份合約
│  ├─ types.ts              訊息格式、事件、錯誤代碼
│  ├─ ChatService.ts        聊天服務介面
│  ├─ MockChatService.ts    階段一：模擬版
│  ├─ createChatService.ts  依 VITE_CHAT_BACKEND 決定用哪一版（唯一知道有兩版的地方）
│  └─ validation.ts         代號與訊息的檢查規則
├─ hooks/       把聊天服務的事件轉成畫面的狀態
├─ components/  畫面零件
├─ screens/     進入畫面、聊天室畫面
└─ styles/      顏色（tokens.css）與各畫面的樣式
```

階段二要做的事：新增 `SupabaseChatService.ts`，在 `createChatService.ts` 加一個分支，其他不用動。

## 部署到 GitHub Pages

1. repo 的 **Settings → Pages → Source** 選 **GitHub Actions**（一次性）。
2. 推到 `main`，`.github/workflows/deploy.yml` 會自動建置並發布。
3. 網址：`https://<GitHub 帳號>.github.io/anonymous-chat/`

repo 改名時，要同步改 `vite.config.ts` 裡的 `REPO_NAME`。

## 金鑰

階段一沒有任何金鑰。階段二也只會用到 Supabase 的 Project URL 和 publishable key，
不需要、也不要使用 secret key。`.env` 開頭的檔案已被 `.gitignore` 擋掉，
只有範本 `.env.example` 會進 git。
