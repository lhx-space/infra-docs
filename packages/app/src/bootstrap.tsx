import {ApiError} from '@luhanxin/api-client';
import {bootstrapCore, type CoreConfig} from '@luhanxin/core';
import {ConsoleReporter, initErrorMonitor} from '@luhanxin/error-monitor';
import {createRootErrorHandlers} from '@luhanxin/error-monitor/react';
import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App';
import {type RouterType, setAppDevMode, setRouterType} from './runtime';
import './styles/globals.css';
import './styles/index.less';
import '@luhanxin/tiptap-editor/styles.css';

export interface AppBootstrapOptions extends CoreConfig {
  /** 是否开发模式：由宿主传入（web 侧即 `import.meta.env.DEV`），控制 DevTools 面板挂载 */
  dev?: boolean;
  appName?: string;
  appVersion?: string;
  /** 路由模式：web 用 browser（默认），desktop 打包后（file:// 协议）必须用 hash */
  routerType?: RouterType;
}

/**
 * app 包的启动入口：宿主（apps/web、apps/desktop）渲染前调用一次。
 * 职责：注入平台配置（core/api-client）、初始化错误监控、挂载根组件。
 */
export function bootstrap(options: AppBootstrapOptions): void {
  setAppDevMode(options.dev ?? false);
  setRouterType(options.routerType ?? 'browser');
  bootstrapCore(options);

  initErrorMonitor({
    reporters: [new ConsoleReporter()],
    appName: options.appName ?? 'infra-docs',
    appVersion: options.appVersion ?? '1.0.0',
    // 把没被业务代码 catch 的 `ApiError` 识别成网络错误，提取 traceId 供跟服务端日志关联
    extractTraceInfo: reason =>
      reason instanceof ApiError
        ? {traceId: reason.traceId, extra: {httpStatus: reason.status}}
        : undefined
  });

  const rootElement = document.getElementById('root');
  if (!rootElement) {
    throw new Error('找不到挂载点 #root，宿主 HTML 里必须存在该元素');
  }
  createRoot(rootElement, createRootErrorHandlers()).render(
    <StrictMode>
      <App />
    </StrictMode>
  );
}
