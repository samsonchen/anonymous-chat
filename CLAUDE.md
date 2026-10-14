# 匿名聊天室

不用登入的匿名聊天室，所有人在同一間，前端放 GitHub Pages，即時傳訊用 Supabase。

## 開始任何工作前

先讀 `docs/architecture.md`。需求在 `docs/requirements.md`。

## 目前進度

目前在**階段二**：前端已完成，聊天服務有模擬版（mock）和 Supabase 版，由 `VITE_CHAT_BACKEND` 選擇。資料庫設定在 `supabase/setup.sql`。

## 規則

- 不可以把金鑰檔案 commit 進 git，包括 `.env`、`.env.*`（只有 `.env.example` 可以 commit，而且不能有真實的值）。
- 不使用也不複製 Supabase 的 secret key（`sb_secret_…`、`service_role`），這個專案用不到。
