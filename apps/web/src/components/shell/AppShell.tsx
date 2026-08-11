import {PanelLeft} from 'lucide-react';
import type {ReactNode} from 'react';
import {Button} from '@/components/ui/button';
import {useShellStore} from '@/store/shell';
import {PageHeaderProvider, usePageHeaderState} from './PageHeaderContext';
import {Sidebar} from './Sidebar';
import {UserMenu} from './UserMenu';

interface AppShellProps {
  children: ReactNode;
}

/**
 * 登录后所有路由的共享布局：Sidebar + [Header + Content] 两栏结构。
 * 折叠时 Sidebar 整体不渲染（Content 占满剩余宽度），左上角固定悬浮一个展开按钮。
 *
 * Header 是这一层新增的关键结构：页面标题/操作按钮不再由各页面自己在内容区第一行
 * 手写（曾经导致跟悬浮的头像意外对齐、看起来像 Header 但其实是两套独立定位），
 * 而是通过 `PageHeader` 组件把内容"投递"进这里统一渲染，跟头像固定在同一行。
 */
export function AppShell({children}: AppShellProps) {
  const sidebarCollapsed = useShellStore(state => state.sidebarCollapsed);
  const toggleSidebar = useShellStore(state => state.toggleSidebar);
  const headerState = usePageHeaderState();

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

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b px-6">
          <div className="min-w-0 truncate text-lg font-semibold">{headerState.header.title}</div>
          <div className="flex shrink-0 items-center gap-3">
            {headerState.header.actions}
            <UserMenu />
          </div>
        </header>

        <main className="min-w-0 flex-1 overflow-y-auto">
          <PageHeaderProvider value={headerState}>{children}</PageHeaderProvider>
        </main>
      </div>
    </div>
  );
}
