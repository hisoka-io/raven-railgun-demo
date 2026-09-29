/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_OBSERVER_URL?: string;
  readonly VITE_SUBSQUID_URL?: string;
  readonly VITE_PPOI_PUBLIC_URL?: string;
  readonly VITE_ETH_RPC_URL?: string;
  readonly VITE_IPFS_GATEWAY?: string;
  readonly VITE_IP_ECHO_URL?: string;
  readonly VITE_NOX_SEED_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
