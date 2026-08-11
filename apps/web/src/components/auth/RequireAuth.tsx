import type {ReactNode} from 'react';
import {Navigate} from 'react-router-dom';
import {RouteLoading} from '@/router/RouteLoading';
import {useAuthStore} from '@/store/auth';

interface RequireAuthProps {
  children: ReactNode;
}

/** 未登录用户访问受保护路由时重定向到 /login；会话恢复完成前展示 loading，避免误判闪现 */
export function RequireAuth({children}: RequireAuthProps) {
  const status = useAuthStore(state => state.status);

  if (status === 'idle' || status === 'loading') {
    return <RouteLoading />;
  }

  if (status === 'unauthenticated') {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}
