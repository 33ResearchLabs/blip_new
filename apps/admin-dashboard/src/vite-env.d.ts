/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CORE_WS_URL?: string;
  readonly VITE_SUPPORT_ADMIN_SECRET?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
