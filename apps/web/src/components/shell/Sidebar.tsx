import {BookOpen, ChevronsLeft, Home as HomeIcon, Pin, Plus, Search} from 'lucide-react';
import {useEffect, useState} from 'react';
import {Link, useLocation} from 'react-router-dom';
import {SearchDialog} from '@/components/search/SearchDialog';
import {Button} from '@/components/ui/button';
import {CreateWikiDialog} from '@/components/wiki/CreateWikiDialog';
import {useResizable} from '@/hooks/use-resizable';
import {cn} from '@/lib/utils';
import {usePinnedStore} from '@/store/pinned';
import {useShellStore} from '@/store/shell';
import {useTeamStore} from '@/store/team';
import {useWikiStore} from '@/store/wiki';
import {TeamSwitcher} from './TeamSwitcher';

/** 登录后所有页面共享的侧边栏：品牌区、团队切换器、导航结构、宽度可拖拽 */
export function Sidebar() {
  const location = useLocation();
  const sidebarWidth = useShellStore(state => state.sidebarWidth);
  const setSidebarWidth = useShellStore(state => state.setSidebarWidth);
  const toggleSidebar = useShellStore(state => state.toggleSidebar);
  const pinnedWikiIds = usePinnedStore(state => state.pinnedWikiIds);
  const wikis = useWikiStore(state => state.wikis);
  const fetchWikis = useWikiStore(state => state.fetchWikis);
  const teams = useTeamStore(state => state.teams);
  const fetchMyTeams = useTeamStore(state => state.fetchMyTeams);
  const currentTeamId = useTeamStore(state => state.currentTeamId);

  const [searchOpen, setSearchOpen] = useState(false);
  // "+" 之前只是 navigate('/wiki') 跳到列表页，并没有真正创建 Wiki 的动作——
  // 直接在 Sidebar 本地持有一份创建弹窗状态，跟 WikiList.tsx 里的用法一致，
  // 点击即弹窗，不需要先跳转再在列表页里点一次"新建 Wiki"。
  const [createWikiOpen, setCreateWikiOpen] = useState(false);

  // Sidebar 和 WikiList 页面共享同一份列表数据，避免同样的 GET /wikis 被拉两次（见 design.md 决策 7）：
  // 只有 store 里还没有数据时才触发一次拉取；`http.get` 传输层的 Singleflight 去重也覆盖了
  // "两者恰好同时挂载"这种并发场景，这里不需要额外处理。
  useEffect(() => {
    if (wikis.length === 0) void fetchWikis();
  }, [wikis.length, fetchWikis]);

  useEffect(() => {
    if (teams.length === 0) void fetchMyTeams();
  }, [teams.length, fetchMyTeams]);

  // "Wiki" 分区（全部列表）只展示归属当前团队的工作区——这是团队切换器存在的核心意义：
  // 下面能看到的内容只属于切换器里选中的那个团队（见 team-switcher spec.md「工作区以
  // Card 形式展示」）；置顶列表（下方）刻意不做这层过滤，保持跨团队展示。
  const teamWikis = wikis.filter(wiki => wiki.teamId === currentTeamId);

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

        {/* 团队切换器：下面所有团队区块内容（Wiki 列表等）只属于这里选中的团队，
            切换是纯本地状态变化，不发生路由跳转（见 team-switcher design.md 决策 2/3） */}
        <div className="px-2 pb-2">
          <TeamSwitcher />
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

          {pinnedWikiIds.length > 0 ? (
            <div className="mt-4 flex flex-col gap-1">
              <span className="px-3 text-xs font-medium text-muted-foreground">置顶</span>
              {pinnedWikiIds.map(id => {
                // 找不到（列表还没加载完 / 该 Wiki 已被删除）时兜底显示原始 id，不阻塞渲染（见 design.md 决策 7）；
                // 置顶列表跨团队展示，不受 currentTeamId 筛选（见 team-switcher design.md 决策 3）
                const name = wikis.find(w => w.id === id)?.name ?? id;
                return (
                  <Link
                    key={id}
                    to={`/wiki/${id}`}
                    className="flex items-center gap-2 rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-sidebar-accent"
                  >
                    <Pin className="size-3.5" />
                    <span className="truncate">{name}</span>
                  </Link>
                );
              })}
            </div>
          ) : null}

          <div className="mt-4 flex items-center justify-between px-3">
            <span className="text-xs font-medium text-muted-foreground">Wiki</span>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => setCreateWikiOpen(true)}
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

          {teamWikis.length > 0 ? (
            <div className="flex flex-col gap-1 pl-2">
              {teamWikis.map(wiki => (
                <Link
                  key={wiki.id}
                  to={`/wiki/${wiki.id}`}
                  className="flex items-center gap-2 truncate rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-sidebar-accent"
                >
                  <span className="truncate">{wiki.name}</span>
                </Link>
              ))}
            </div>
          ) : (
            <p className="px-3 text-xs text-muted-foreground">当前团队还没有 Wiki</p>
          )}
        </nav>

        {/* 拖拽调整宽度的热区：hover 出现可拖拽光标，最小/最大宽度钳制在 store/shell.ts 里做 */}
        {/* biome-ignore lint/a11y/noStaticElementInteractions: 拖拽调宽热区，键盘可达的替代方案（如方向键调宽）留待后续单独实现 */}
        <div
          className="absolute inset-y-0 right-0 w-1 cursor-col-resize hover:bg-primary/30"
          onMouseDown={handleResizeStart}
        />
      </aside>

      <SearchDialog open={searchOpen} onOpenChange={setSearchOpen} />
      <CreateWikiDialog open={createWikiOpen} onOpenChange={setCreateWikiOpen} />
    </>
  );
}
