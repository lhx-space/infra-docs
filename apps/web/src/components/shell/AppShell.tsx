import {ErrorBoundary} from '@luhanxin/error-monitor/react';
import {PanelLeft} from 'lucide-react';
import type {ReactNode} from 'react';
import {useLocation, useNavigate} from 'react-router-dom';
import {Button} from '@/components/ui/button';
import {useShellStore} from '@/store/shell';
import {PageHeaderProvider, usePageHeaderState} from './PageHeaderContext';
import {Sidebar} from './Sidebar';
import {UserMenu} from './UserMenu';

interface AppShellProps {
  children: ReactNode;
}

function ContentErrorFallback() {
  const navigate = useNavigate();
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-4 text-center">
      <p className="text-lg font-semibold">这个页面出错了</p>
      <p className="text-sm text-muted-foreground">
        你可以先返回首页，或者点击 Sidebar 切换到其他页面
      </p>
      <Button onClick={() => navigate('/home')}>返回首页</Button>
    </div>
  );
}

export function AppShell({children}: AppShellProps) {
  const sidebarCollapsed = useShellStore(state => state.sidebarCollapsed);
  const toggleSidebar = useShellStore(state => state.toggleSidebar);
  const headerState = usePageHeaderState();
  const location = useLocation();

  return (
    <div className="flex h-svh w-full">
      {sidebarCollapsed ? null : <Sidebar />}

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-4 border-b px-6">
          {sidebarCollapsed ? (
            <Button
              variant="outline"
              size="icon"
              className="shrink-0"
              onClick={toggleSidebar}
              aria-label="展开侧边栏"
            >
              <PanelLeft className="size-4" />
            </Button>
          ) : null}
          <div className="min-w-0 flex-1 truncate text-lg font-semibold">
            {headerState.header.title}
          </div>
          <div className="flex shrink-0 items-center gap-3">
            {headerState.header.actions}
            <UserMenu />
          </div>
        </header>

        <main className="min-h-0 min-w-0 flex-1 overflow-y-auto">
          <ErrorBoundary key={location.pathname} fallback={<ContentErrorFallback />}>
            <PageHeaderProvider value={headerState}>{children}</PageHeaderProvider>
          </ErrorBoundary>
        </main>
      </div>
    </div>
  );
}
