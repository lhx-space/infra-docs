import {lazy, type ReactNode, Suspense} from 'react';
import {Outlet, type RouteObject} from 'react-router-dom';
import {RequireAuth} from '@/components/auth/RequireAuth';
import {RequireGuest} from '@/components/auth/RequireGuest';
import {RouteLoading} from './RouteLoading';
import type {AppRouteConfig, RouteMeta} from './types';

function withGuard(meta: RouteMeta | undefined, element: ReactNode): ReactNode {
  if (meta?.requiresAuth) return <RequireAuth>{element}</RequireAuth>;
  if (meta?.guestOnly) return <RequireGuest>{element}</RequireGuest>;
  return element;
}

/**
 * 构建单个路由节点的 element：
 * - 有 component：懒加载该页面
 * - 无 component（纯分组/布局节点）：渲染 <Outlet /> 承载子路由
 * - 有 layout：用 layout 包裹上面的结果（布局内部通过 children 渲染 Outlet/页面）
 * - 最后根据 meta 决定是否包一层鉴权守卫
 */
function buildElement(config: AppRouteConfig): ReactNode {
  let inner: ReactNode;

  if (config.component) {
    const LazyComponent = lazy(config.component);
    inner = (
      <Suspense fallback={<RouteLoading />}>
        <LazyComponent />
      </Suspense>
    );
  } else {
    inner = <Outlet />;
  }

  if (config.layout) {
    const Layout = config.layout;
    inner = <Layout>{inner}</Layout>;
  }

  return withGuard(config.meta, inner);
}

function toRouteObject(config: AppRouteConfig): RouteObject {
  const element = buildElement(config);
  const children = config.children?.map(toRouteObject);

  if (config.index) {
    return {index: true, element, handle: config.meta};
  }

  return {path: config.path, element, handle: config.meta, children};
}

/** 将 AppRouteConfig[] 转换为 react-router 的 RouteObject[]，统一处理懒加载、布局包裹与路由守卫 */
export function buildRoutes(configs: AppRouteConfig[]): RouteObject[] {
  return configs.map(toRouteObject);
}
