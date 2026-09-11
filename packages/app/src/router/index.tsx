import {useAuthStore} from '@luhanxin/core';
import {useEffect} from 'react';
import {createBrowserRouter, createHashRouter, RouterProvider} from 'react-router-dom';
import {getRouterType} from '../runtime';
import {buildRoutes} from './build-routes';
import {syncDocumentTitle} from './document-title';
import {routes} from './routes';

/**
 * 按宿主注入的 `routerType` 创建路由：
 * - browser：apps/web 用（干净路径 /wiki/...，依赖 http 服务器的 history fallback）。
 * - hash：apps/desktop 打包后用（`file://` 协议下 BrowserRouter 拿不到可匹配的 pathname，
 *   会直接 404，见 apps/desktop/src/main/index.ts 里 `loadFile` 的说明）。
 *
 * 路由在首次渲染时懒创建一次（`routerType` 由 `bootstrap()` 注入，晚于模块 import、
 * 早于 React 渲染），并用模块级缓存保证 StrictMode 双渲染/双挂载不会重复建两个实例。
 */
let cachedRouter: ReturnType<typeof createBrowserRouter> | null = null;

function createAppRouter() {
  const createRouter = getRouterType() === 'hash' ? createHashRouter : createBrowserRouter;
  const router = createRouter(buildRoutes(routes));
  syncDocumentTitle(router);
  return router;
}

function getRouter() {
  cachedRouter ??= createAppRouter();
  return cachedRouter;
}

export function AppRouter() {
  useEffect(() => {
    void useAuthStore.getState().initAuth();
  }, []);

  return <RouterProvider router={getRouter()} />;
}
