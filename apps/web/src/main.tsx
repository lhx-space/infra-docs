import {bootstrap} from '@luhanxin/app';

/**
 * apps/web 薄宿主：真正的应用（页面/路由/store/组件）都在 `@luhanxin/app` 包里，
 * 这里只负责把 web 特有的环境配置注入进去再启动。平台差异（API 地址、协同 WS 地址、
 * 是否开发模式）都在这一层用 `import.meta.env` 读取并传入，包源码不感知 Vite。
 */
bootstrap({
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL,
  collabWsUrl: import.meta.env.VITE_COLLAB_WS_URL,
  dev: import.meta.env.DEV,
  appName: 'infra-docs-web',
  appVersion: '1.0.0'
});
