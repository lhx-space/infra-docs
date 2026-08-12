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
 * 折叠时 Sidebar 整体不渲染（Content 占满剩余宽度），展开按钮挪进 Header 最左侧占一个
 * 固定位置（而不是 `fixed` 悬浮在页面左上角）——悬浮定位不占布局空间，会直接叠在 Header
 * 标题文字上面（标题左边距只有 24px，按钮却从 12px 开始占了约 36px 宽度），两者视觉上
 * 挤在一起、看起来像重叠了。放进 Header 的正常文档流里，标题自然被推到按钮右边，不会
 * 再有重叠问题。
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
    // 这里用 `h-svh`（固定为视口高度）而不是 `min-h-svh`：`min-h-*` 只设最小高度，
    // 内容一旦超出就会把这个容器和 `<body>` 一起撑高，导致滚动发生在浏览器文档层面
    // （也就是"整个页面都在滚动"），而不是下面 `<main>` 自己的 `overflow-y-auto` 生效。
    // 固定高度后 `<main>` 才是唯一、真正会滚动的容器。
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

        {/* `min-h-0` 是关键：没有它，flex 子项默认按内容撑高，`overflow-y-auto` 永远不会
            真正触发裁剪+滚动，溢出会一路往上传导到 `<body>`（见上面的说明）。 */}
        <main className="min-h-0 min-w-0 flex-1 overflow-y-auto">
          <PageHeaderProvider value={headerState}>{children}</PageHeaderProvider>
        </main>
      </div>
    </div>
  );
}
