import {AuthLayout} from '@/components/auth/AuthLayout';
import {AppShell} from '@/components/shell/AppShell';
import type {AppRouteConfig} from './types';

/**
 * 应用路由表：新增页面只需在此追加一项，无需改动路由渲染逻辑。
 * component 均为懒加载工厂函数，构建时会被拆分为独立 chunk。
 *
 * layout 挂在分组节点上，其 children 通过 Outlet 挂载，页面组件本身不需要关心自己用什么布局；
 * meta.requiresAuth/guestOnly 也挂在分组节点上统一做鉴权守卫，子路由无需重复声明。
 */
export const routes: AppRouteConfig[] = [
  {
    layout: AuthLayout,
    meta: {guestOnly: true},
    children: [
      {
        path: '/login',
        component: () => import('@/pages/Login'),
        meta: {title: '登录'}
      },
      {
        path: '/register',
        component: () => import('@/pages/Register'),
        meta: {title: '注册'}
      }
    ]
  },
  {
    layout: AppShell,
    meta: {requiresAuth: true},
    children: [
      {
        path: '/',
        component: () => import('@/pages/Storage'),
        meta: {title: 'Manage Storage'}
      },
      {
        path: '/home',
        component: () => import('@/pages/Home'),
        meta: {title: 'Home'}
      },
      {
        path: '/wiki',
        component: () => import('@/pages/wiki/WikiList'),
        meta: {title: 'Wiki'}
      },
      {
        path: '/wiki/:wikiId',
        component: () => import('@/pages/wiki/WikiDetail'),
        meta: {title: 'Wiki 详情'}
      }
    ]
  }
];
