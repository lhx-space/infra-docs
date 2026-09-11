import {useAuthStore} from '@luhanxin/core';
import type {ReactNode} from 'react';
import {Navigate} from 'react-router-dom';
import {RouteLoading} from '@/router/RouteLoading';

interface RequireGuestProps {
  children: ReactNode;
}

/** 已登录用户访问 /login、/register 等公开路由时重定向回主页 */
export function RequireGuest({children}: RequireGuestProps) {
  const status = useAuthStore(state => state.status);

  if (status === 'idle' || status === 'loading') {
    return <RouteLoading />;
  }

  if (status === 'authenticated') {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
