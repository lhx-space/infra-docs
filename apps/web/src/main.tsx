import {ConsoleReporter, initErrorMonitor} from '@luhanxin/error-monitor';
import {createRootErrorHandlers} from '@luhanxin/error-monitor/react';
import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './styles/globals.css';
import './styles/index.less';
import '@luhanxin/tiptap-editor/styles.css';

// 应用启动时挂载一次全局监听器（全局同步异常/未捕获 Promise rejection/资源加载失败），
// 覆盖 `ErrorBoundary` 完全捕获不到的那部分运行时错误（见 error-monitor proposal.md「Why」）。
// 目前只接了 `ConsoleReporter` 占位跑通协议，后端上报接口定了之后直接在这里追加一个
// `HttpReporter` 实例即可，不需要改动任何采集侧代码。
initErrorMonitor({
  reporters: [new ConsoleReporter()],
  appName: 'infra-docs',
  appVersion: '1.0.0'
});

// console.log(namelist)

createRoot(document.getElementById('root')!, createRootErrorHandlers()).render(
  <StrictMode>
    <App />
  </StrictMode>
);
