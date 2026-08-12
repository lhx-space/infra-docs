import {Plus} from 'lucide-react';
import {useEffect, useMemo, useState} from 'react';
import {EmptyState} from '@/components/shared/EmptyState';
import {PageHeader} from '@/components/shell/PageHeaderContext';
import {Button} from '@/components/ui/button';
import {CreateWikiDialog} from '@/components/wiki/CreateWikiDialog';
import {WikiCard} from '@/components/wiki/WikiCard';
import {WikiSettingsDialog} from '@/components/wiki/WikiSettingsDialog';
import {usePinnedStore} from '@/store/pinned';
import {useCurrentTeam} from '@/store/team';
import type {Wiki} from '@/store/wiki';
import {useWikiStore} from '@/store/wiki';

/**
 * Wiki 列表页：Card 网格展示归属"当前团队"（Sidebar 顶部团队切换器选中的那个）的工作区——
 * 不再是跨团队汇总视图（见 team-switcher spec.md「工作区以 Card 形式展示」，**BREAKING**）；
 * 提供创建入口；卡片本身承载 hover 设置入口和 Pin。
 *
 * 顶部的"已置顶"分区刻意不受当前团队筛选，跨团队展示全部置顶工作区——置顶的价值就是
 * "不管我在哪个团队下都能一键跳过去"，被当前团队筛掉就失去了这个价值
 * （见 team-switcher design.md 决策 3、spec.md「Wiki 列表页展示已置顶分区」）。
 */
export default function WikiList() {
  const wikis = useWikiStore(state => state.wikis);
  const fetchWikis = useWikiStore(state => state.fetchWikis);
  const pinnedWikiIds = usePinnedStore(state => state.pinnedWikiIds);
  const currentTeam = useCurrentTeam();
  const [createOpen, setCreateOpen] = useState(false);
  const [settingsWiki, setSettingsWiki] = useState<Wiki | null>(null);

  useEffect(() => {
    void fetchWikis();
  }, [fetchWikis]);

  // pinnedWikiIds 可能包含已经不在 wikis 里的陈旧 id（清理是异步的，fetchWikis 完成前有一个短暂窗口）；
  // 用 wikis 的顺序过滤一遍，保证这里展示的永远是"当前真实可见"的置顶工作区，不会渲染出裸 id。
  // 注意：这里故意不按当前团队筛选（跨团队展示），跟下方常规网格的筛选范围不同。
  const pinnedWikis = useMemo(
    () => wikis.filter(wiki => pinnedWikiIds.includes(wiki.id)),
    [wikis, pinnedWikiIds]
  );

  // 常规网格只展示归属当前团队的工作区；整个账号下没有任何 Wiki（跨团队都没有）跟
  // "当前团队下没有 Wiki 但其他团队有"是两种不同的空态，文案需要区分开，不能混用一句话。
  const teamWikis = useMemo(
    () => (currentTeam ? wikis.filter(wiki => wiki.teamId === currentTeam.id) : []),
    [wikis, currentTeam]
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
              <h2 className="text-sm font-medium text-muted-foreground">已置顶（跨团队）</h2>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {pinnedWikis.map(wiki => (
                  <WikiCard key={wiki.id} wiki={wiki} onOpenSettings={setSettingsWiki} />
                ))}
              </div>
            </div>
          ) : null}

          <div className="flex flex-col gap-3">
            {pinnedWikis.length > 0 ? (
              <h2 className="text-sm font-medium text-muted-foreground">
                {currentTeam?.isPersonal ? '个人空间' : currentTeam?.name}
              </h2>
            ) : null}
            {teamWikis.length === 0 ? (
              <EmptyState
                title="当前团队还没有 Wiki"
                description="账号下其他团队可能有 Wiki，切换 Sidebar 顶部的团队试试；也可以直接在这个团队下新建一个"
                action={createButton}
              />
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {teamWikis.map(wiki => (
                  <WikiCard key={wiki.id} wiki={wiki} onOpenSettings={setSettingsWiki} />
                ))}
              </div>
            )}
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
