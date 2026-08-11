import {Plus} from 'lucide-react';
import {useEffect, useMemo, useState} from 'react';
import {EmptyState} from '@/components/shared/EmptyState';
import {PageHeader} from '@/components/shell/PageHeaderContext';
import {Button} from '@/components/ui/button';
import {CreateWikiDialog} from '@/components/wiki/CreateWikiDialog';
import {WikiCard} from '@/components/wiki/WikiCard';
import {WikiSettingsDialog} from '@/components/wiki/WikiSettingsDialog';
import {usePinnedStore} from '@/store/pinned';
import type {Wiki} from '@/store/wiki';
import {useWikiStore} from '@/store/wiki';

/**
 * Wiki 列表页：Card 网格展示当前用户可见的工作区（后端已经按"我是成员"过滤，见 spec.md
 * 「工作区以 Card 形式展示」），提供创建入口；卡片本身承载 hover 设置入口和 Pin。
 * 顶部的"已置顶"分区只是常规网格的快捷入口，置顶的工作区仍会正常出现在下方完整网格里
 * （见 wiki-workspace-fixes spec.md「Wiki 列表页展示已置顶分区」）。
 */
export default function WikiList() {
  const wikis = useWikiStore(state => state.wikis);
  const fetchWikis = useWikiStore(state => state.fetchWikis);
  const pinnedWikiIds = usePinnedStore(state => state.pinnedWikiIds);
  const [createOpen, setCreateOpen] = useState(false);
  const [settingsWiki, setSettingsWiki] = useState<Wiki | null>(null);

  useEffect(() => {
    void fetchWikis();
  }, [fetchWikis]);

  // pinnedWikiIds 可能包含已经不在 wikis 里的陈旧 id（清理是异步的，fetchWikis 完成前有一个短暂窗口）；
  // 用 wikis 的顺序过滤一遍，保证这里展示的永远是"当前真实可见"的置顶工作区，不会渲染出裸 id
  const pinnedWikis = useMemo(
    () => wikis.filter(wiki => pinnedWikiIds.includes(wiki.id)),
    [wikis, pinnedWikiIds]
  );

  const createButton = (
    <Button onClick={() => setCreateOpen(true)}>
      <Plus className="size-4" />
      新建 Wiki
    </Button>
  );

  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <PageHeader title="Wiki" actions={wikis.length > 0 ? createButton : null} />

      {wikis.length === 0 ? (
        <EmptyState
          title="还没有 Wiki"
          description="创建一个 Wiki 工作区来组织你的文章"
          action={createButton}
        />
      ) : (
        <>
          {pinnedWikis.length > 0 ? (
            <div className="flex flex-col gap-3">
              <h2 className="text-sm font-medium text-muted-foreground">已置顶</h2>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {pinnedWikis.map(wiki => (
                  <WikiCard key={wiki.id} wiki={wiki} onOpenSettings={setSettingsWiki} />
                ))}
              </div>
            </div>
          ) : null}

          <div className="flex flex-col gap-3">
            {pinnedWikis.length > 0 ? (
              <h2 className="text-sm font-medium text-muted-foreground">全部</h2>
            ) : null}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {wikis.map(wiki => (
                <WikiCard key={wiki.id} wiki={wiki} onOpenSettings={setSettingsWiki} />
              ))}
            </div>
          </div>
        </>
      )}

      <CreateWikiDialog open={createOpen} onOpenChange={setCreateOpen} />
      <WikiSettingsDialog
        wiki={settingsWiki}
        open={settingsWiki !== null}
        onOpenChange={next => {
          if (!next) setSettingsWiki(null);
        }}
      />
    </div>
  );
}
