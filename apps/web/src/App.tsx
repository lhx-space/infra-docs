import {ErrorBoundary, ErrorMonitorDevTools} from '@luhanxin/error-monitor/react';
import {Toaster} from 'sonner';
import {Button} from '@/components/ui/button';
import {AppRouter} from './router';
import {useThemeStore} from './store/theme';

/**
 * 最外层兜底：挡路由/Provider 级别的灾难性错误（见 error-monitor design.md 决策 4）。
 * 页面级/内容区级的渲染错误由 `AppShell.tsx` 内容区那一层 `ErrorBoundary` 先接住，
 * 这一层只兜"连那一层都没能接住"的情况，所以给的是整页级刷新兜底，不是"返回上一页"
 * 这种还假设应用主体结构完好的操作。
 */
function AppErrorFallback() {
  return (
    <div className="flex h-svh w-full flex-col items-center justify-center gap-4 text-center">
      <p className="text-lg font-semibold">页面出错了</p>
      <p className="text-sm text-muted-foreground">刷新页面通常可以解决这个问题</p>
      <Button onClick={() => window.location.reload()}>刷新页面</Button>
    </div>
  );
}

export default function App() {
  const resolvedTheme = useThemeStore(state => state.resolvedTheme);
  return (
    <>
      <ErrorBoundary fallback={<AppErrorFallback />}>
        <AppRouter />
      </ErrorBoundary>
      <Toaster theme={resolvedTheme} position="top-center" richColors closeButton />
      {/* 仅开发环境挂载：`import.meta.env.DEV` 是 Vite 编译期静态量，生产构建会连同
          `ErrorMonitorDevTools` 的 import 一起被 Rollup 死代码消除，不会进生产包。
          单独包一层 `ErrorBoundary`（跟上面挡应用主体的那层完全独立）：devtools 面板里
          "触发 render 错误" 按钮是故意让这个小组件自己崩溃来验证捕获链路，不应该带崩
          整个页面主体，也不需要参与上面 `AppErrorFallback` 的整页刷新兜底。 */}
      {import.meta.env.DEV ? (
        <ErrorBoundary fallback={null}>
          <ErrorMonitorDevTools />
        </ErrorBoundary>
      ) : null}
    </>
  );
}
