/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** mock = 階段一模擬版（預設）；supabase = 階段二 */
  readonly VITE_CHAT_BACKEND?: string
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
