import {useAuthStore} from '@luhanxin/core';
import {getDesktopBridge} from '@luhanxin/desktop-bridge';
import {useEffect} from 'react';
import {createBrowserRouter, createHashRouter, RouterProvider} from 'react-router-dom';
import {getRouterType} from '../runtime';
import {buildRoutes} from './build-routes';
import {syncDocumentTitle} from './document-title';
import {RouteError} from './RouteError';
import {routes} from './routes';

/**
 * 按宿主注入的 `routerType` 创建路由：
 * - browser：apps/web 用（干净路径 /wiki/...，依赖 http 服务器的 history fallback）。
 * - hash：预留（`file://` 协议下 BrowserRouter 无法匹配 pathname，历史兜底方案）。
 *
 * 路由在首次渲染时懒创建一次（`routerType` 由 `bootstrap()` 注入，晚于模块 import、
 * 早于 React 渲染），并用模块级缓存保证 StrictMode 双渲染/双挂载不会重复建两个实例。
 */
let cachedRouter: ReturnType<typeof createBrowserRouter> | null = null;

function createAppRouter() {
  const createRouter = getRouterType() === 'hash' ? createHashRouter : createBrowserRouter;
  const router = createRouter([
    {
      // 根级 errorElement：接住路由未匹配（404）与 loader/action 抛错，替换默认错误页
      errorElement: <RouteError />,
      children: buildRoutes(routes)
    }
  ]);
  syncDocumentTitle(router);
  return router;
}

function getRouter() {
  cachedRouter ??= createAppRouter();
  return cachedRouter;
}

/** 把深链 url（luhanxin-docs-app://app/share-links/TOKEN）解析成前端路由路径 */
function deepLinkPath(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'luhanxin-docs-app:') return null;
    return parsed.pathname || '/';
  } catch {
    return null;
  }
}

export function AppRouter() {
  useEffect(() => {
    void useAuthStore.getState().initAuth();

    // 订阅桌面深链：收到 luhanxin-docs-app://... 时导航到对应路由（分享/邀请链接）
    const bridge = getDesktopBridge();
    const router = getRouter();
    if (!bridge) return;
    return bridge.onDeepLink(url => {
      const path = deepLinkPath(url);
      if (path) void router.navigate(path);
    });
  }, []);

  return <RouterProvider router={getRouter()} />;
}
