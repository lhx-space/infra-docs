import {Button} from '@luhanxin/ui';
import {isRouteErrorResponse, useNavigate, useRouteError} from 'react-router-dom';

/**
 * React Router 的根级 errorElement，替换默认的「💿 Hey developer」错误页。
 *
 * 覆盖的是「路由级」错误——路由未匹配（404）、loader/action 抛错、导航过程中抛错。
 * 组件渲染阶段的异常由 @luhanxin/error-monitor 的 ErrorBoundary 拦（见 App.tsx / AppShell.tsx），
 * 跟这里是两条独立路径，各自兜住各自那一层。
 */
export function RouteError() {
  const error = useRouteError();
  const navigate = useNavigate();

  const isNotFound = isRouteErrorResponse(error) && error.status === 404;

  return (
    <div className="flex h-svh w-full flex-col items-center justify-center gap-4 p-6 text-center">
      <p className="text-lg font-semibold">{isNotFound ? '页面不存在' : '页面出错了'}</p>
      <p className="max-w-md text-sm text-muted-foreground">
        {isNotFound
          ? '你访问的地址不存在，可能已被移动或删除'
          : '页面加载时遇到了问题，返回首页或刷新重试'}
      </p>
      <div className="flex gap-2">
        <Button onClick={() => navigate('/home')}>返回首页</Button>
        <Button variant="outline" onClick={() => window.location.reload()}>
          刷新页面
        </Button>
      </div>
    </div>
  );
}
