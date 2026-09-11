import {bootstrap} from '@luhanxin/app';

/**
 * apps/desktop 的 renderer 薄宿主：与 apps/web 的 main.tsx 一样，只负责把平台配置注入
 * 到 `@luhanxin/app` 再启动。开发期默认连本地服务（apps/api + apps/collab-server），
 * 可用 `import.meta.env.VITE_*` 覆盖（electron-vite 底层是 Vite，同样读取 .env）。
 */
bootstrap({
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000',
  collabWsUrl: import.meta.env.VITE_COLLAB_WS_URL ?? 'ws://localhost:4000/ws',
  dev: import.meta.env.DEV,
  // 打包后 renderer 走自定义协议 luhanxin-docs-app://（见 main/index.ts 的 loadURL），
  // 是 standard scheme，BrowserRouter 可以正常匹配路径，用默认的 browser 路由即可。
  appName: 'infra-docs-desktop',
  appVersion: '1.0.0'
});
