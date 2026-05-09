/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_RAVEN_URL?: string;
  readonly VITE_RAVEN_BEARER: string;
  readonly VITE_RAVEN_TARGET?: string;
  readonly VITE_SUBSQUID_URL?: string;
  readonly VITE_PPOI_PUBLIC_URL?: string;
  readonly VITE_ETH_RPC_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
