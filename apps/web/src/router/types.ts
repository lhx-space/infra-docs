import type {ComponentType, ReactNode} from 'react';

export interface RouteMeta {
  /** 页面标题，可用于后续设置 document.title */
  title?: string;
  /** 需要登录才能访问，未登录跳转 /login */
  requiresAuth?: boolean;
  /** 仅未登录可访问（如登录/注册页），已登录跳转主页 */
  guestOnly?: boolean;
}

/**
 * 类 vue-router 的可配置化路由项：path + 懒加载 component 工厂 + layout + meta + children。
 * 由 `buildRoutes` 转换为 react-router 的 RouteObject 树。
 */
export interface AppRouteConfig {
  path?: string;
  /** 是否为 index 路由（等价于 react-router 的 index route） */
  index?: boolean;
  /**
   * 该节点及其 children 共用的布局组件（如 AuthLayout）。
   * 内部通过 children 承载子路由内容（相当于 vue-router 的 <router-view>/Outlet）。
   * 一般用于给一组路由（如 /login、/register）配置统一布局 + 权限（meta），
   * 无需在每个页面组件里手动 import 布局。
   */
  layout?: ComponentType<{children: ReactNode}>;
  /** 懒加载组件工厂，写法与 vue-router 的 `component: () => import('...')` 一致 */
  component?: () => Promise<{default: ComponentType}>;
  meta?: RouteMeta;
  children?: AppRouteConfig[];
}
