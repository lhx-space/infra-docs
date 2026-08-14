/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL: string;
  /** apps/collab-server 的 WebSocket 地址（见 yjs-realtime-collaboration design.md
   * 决策 8），房间名（文档 id）由调用方拼在路径上，这里只配置到基础地址 */
  readonly VITE_COLLAB_WS_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
