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
 * Home 落地页：展示"已置顶的 Wiki"（跨团队，复用 usePinnedStore + WikiCard）+
 * "当前团队的 Wiki"快捷网格（复用 useCurrentTeam() + teamId 过滤），
 * 两个数据源都是已有 store 里现成的数据，不新增任何接口（见 wiki-integration-gaps
 * design.md 决策 4）。没有置顶时该分区不展示；当前团队没有 Wiki 时展示引导创建的空态。
 */
export default function Home() {
  const wikis = useWikiStore(state => state.wikis);
  const fetchWikis = useWikiStore(state => state.fetchWikis);
  const pinnedWikiIds = usePinnedStore(state => state.pinnedWikiIds);
  const currentTeam = useCurrentTeam();
  const [createOpen, setCreateOpen] = useState(false);
  const [settingsWiki, setSettingsWiki] = useState<Wiki | null>(null);

  useEffect(() => {
    if (wikis.length === 0) void fetchWikis();
  }, [wikis.length, fetchWikis]);

  const pinnedWikis = useMemo(
    () => wikis.filter(wiki => pinnedWikiIds.includes(wiki.id)),
    [wikis, pinnedWikiIds]
  );

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
      <PageHeader title="Home" />

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
        <h2 className="text-sm font-medium text-muted-foreground">
          {currentTeam?.isPersonal ? '个人空间' : currentTeam?.name}
        </h2>
        {teamWikis.length === 0 ? (
          <EmptyState
            title="当前团队还没有 Wiki"
            description="创建一个 Wiki 工作区来组织你的文章，也可以切换 Sidebar 顶部的团队查看其他团队的内容"
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
