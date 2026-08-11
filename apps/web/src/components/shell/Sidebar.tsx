import {BookOpen, ChevronsLeft, Home as HomeIcon, Pin, Plus, Search} from 'lucide-react';
import {useState} from 'react';
import {Link, useLocation, useNavigate} from 'react-router-dom';
import {SearchDialog} from '@/components/search/SearchDialog';
import {Button} from '@/components/ui/button';
import {useResizable} from '@/hooks/use-resizable';
import {cn} from '@/lib/utils';
import {usePinnedStore} from '@/store/pinned';
import {useShellStore} from '@/store/shell';

/** 登录后所有页面共享的侧边栏：品牌区、导航结构、宽度可拖拽 */
export function Sidebar() {
  const location = useLocation();
  const navigate = useNavigate();
  const sidebarWidth = useShellStore(state => state.sidebarWidth);
  const setSidebarWidth = useShellStore(state => state.setSidebarWidth);
  const toggleSidebar = useShellStore(state => state.toggleSidebar);
  const pinnedWikiIds = usePinnedStore(state => state.pinnedWikiIds);

  const [searchOpen, setSearchOpen] = useState(false);
  // 钳制到 200-480px 的业务边界在 setSidebarWidth（store/shell.ts）里做，
  // useResizable 本身只管"拖拽手势 → 实时宽度"这段跟侧边栏身份无关的通用交互逻辑
  const {handleResizeStart} = useResizable({width: sidebarWidth, onResize: setSidebarWidth});

  const isHomeActive = location.pathname === '/home';

  return (
    <>
      <aside
        className="relative flex h-svh flex-col border-r bg-sidebar text-sidebar-foreground"
        style={{width: sidebarWidth}}
      >
        <div className="flex items-center p-2">
          <Button variant="ghost" size="icon-sm" onClick={toggleSidebar} aria-label="折叠侧边栏">
            <ChevronsLeft className="size-4" />
          </Button>
        </div>

        <div className="flex items-center gap-2 px-3 pb-3">
          <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary text-xs font-semibold text-primary-foreground">
            Y
          </div>
          <span className="truncate text-sm font-semibold">Yjs Docs</span>
        </div>

        <div className="border-t" />

        <nav className="flex flex-1 flex-col gap-1 overflow-y-auto p-2">
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm text-muted-foreground hover:bg-sidebar-accent"
          >
            <Search className="size-4" />
            搜索...
          </button>

          <Link
            to="/home"
            className={cn(
              'flex items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-sidebar-accent',
              isHomeActive && 'bg-sidebar-accent font-medium'
            )}
          >
            <HomeIcon className="size-4" />
            Home
          </Link>

          <div className="mt-4 flex items-center justify-between px-3">
            <span className="text-xs font-medium text-muted-foreground">Wiki</span>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => navigate('/wiki')}
              aria-label="新建 Wiki"
            >
              <Plus className="size-3.5" />
            </Button>
          </div>
          <Link
            to="/wiki"
            className="flex items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-sidebar-accent"
          >
            <BookOpen className="size-4" />
            全部 Wiki
          </Link>

          {pinnedWikiIds.length > 0 ? (
            <div className="flex flex-col gap-1 pl-2">
              {pinnedWikiIds.map(id => (
                <Link
                  key={id}
                  to={`/wiki/${id}`}
                  className="flex items-center gap-2 rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-sidebar-accent"
                >
                  <Pin className="size-3.5" />
                  <span className="truncate">{id}</span>
                </Link>
              ))}
            </div>
          ) : null}

          <div className="mt-4 px-3 text-xs font-medium text-muted-foreground">我的文档</div>
        </nav>

        {/* 拖拽调整宽度的热区：hover 出现可拖拽光标，最小/最大宽度钳制在 store/shell.ts 里做 */}
        {/* biome-ignore lint/a11y/noStaticElementInteractions: 拖拽调宽热区，键盘可达的替代方案（如方向键调宽）留待后续单独实现 */}
        <div
          className="absolute inset-y-0 right-0 w-1 cursor-col-resize hover:bg-primary/30"
          onMouseDown={handleResizeStart}
        />
      </aside>

      <SearchDialog open={searchOpen} onOpenChange={setSearchOpen} />
    </>
  );
}
