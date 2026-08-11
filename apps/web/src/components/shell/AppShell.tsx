import {PanelLeft} from 'lucide-react';
import type {ReactNode} from 'react';
import {Button} from '@/components/ui/button';
import {useShellStore} from '@/store/shell';
import {Sidebar} from './Sidebar';
import {UserMenu} from './UserMenu';

interface AppShellProps {
  children: ReactNode;
}

/**
 * 登录后所有路由的共享布局：Sidebar + Content 两栏结构。
 * 折叠时 Sidebar 整体不渲染（Content 占满剩余宽度），左上角固定悬浮一个展开按钮。
 * 用户信息（头像+用户名+退出登录）固定悬浮在页面右上角，独立于 Sidebar 折叠状态。
 */
export function AppShell({children}: AppShellProps) {
  const sidebarCollapsed = useShellStore(state => state.sidebarCollapsed);
  const toggleSidebar = useShellStore(state => state.toggleSidebar);

  return (
    <div className="flex min-h-svh w-full">
      {sidebarCollapsed ? (
        <Button
          variant="outline"
          size="icon"
          className="fixed left-3 top-3 z-50"
          onClick={toggleSidebar}
          aria-label="展开侧边栏"
        >
          <PanelLeft className="size-4" />
        </Button>
      ) : (
        <Sidebar />
      )}

      <div className="fixed right-3 top-3 z-50">
        <UserMenu />
      </div>

      <main className="min-w-0 flex-1 overflow-y-auto">{children}</main>
    </div>
  );
}
