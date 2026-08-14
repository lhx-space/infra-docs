import {ConsoleReporter, initErrorMonitor} from '@luhanxin/error-monitor';
import {createRootErrorHandlers} from '@luhanxin/error-monitor/react';
import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import {ApiError} from './network/errors';
import './styles/globals.css';
import './styles/index.less';
import '@luhanxin/tiptap-editor/styles.css';

// 应用启动时挂载一次全局监听器（全局同步异常/未捕获 Promise rejection/资源加载失败/
// WebSocket·SSE 连接失败），覆盖 `ErrorBoundary` 完全捕获不到的那部分运行时错误
// （见 error-monitor proposal.md「Why」）。目前只接了 `ConsoleReporter` 占位跑通协议，
// 后端上报接口定了之后直接在这里追加一个 `HttpReporter` 实例即可，不需要改动任何
// 采集侧代码（见 error-monitor-network-support design.md Non-Goals：本轮不实例化
// 启用 `HttpReporter`）。
//
// `extractTraceInfo`：把没被业务代码 catch 的 `ApiError`（未处理的 Promise rejection/
// 手动上报）识别成网络错误，提取 `apps/api` 回传的 `traceId`，供跟服务端日志关联
// （见 design.md 决策 2 的具体实现约定：这行 `instanceof ApiError` 判断留在 apps/web
// 里，`error-monitor` 全程不 import 任何跟 `ApiError`/HTTP 相关的东西）。
initErrorMonitor({
  reporters: [new ConsoleReporter()],
  appName: 'infra-docs',
  appVersion: '1.0.0',
  extractTraceInfo: reason =>
    reason instanceof ApiError
      ? {traceId: reason.traceId, extra: {httpStatus: reason.status}}
      : undefined
});

// console.log(namelist)

createRoot(document.getElementById('root')!, createRootErrorHandlers()).render(
  <StrictMode>
    <App />
  </StrictMode>
);
