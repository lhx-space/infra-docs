import type {Wiki} from '@luhanxin/core';
import {
  formatDate,
  relativeTime,
  useCurrentTeam,
  usePinnedStore,
  useWikiStore
} from '@luhanxin/core';
import {Button, cn, DataTable, type DataTableColumn, EmptyState} from '@luhanxin/ui';
import {Pin, Plus, Settings} from 'lucide-react';
import {useEffect, useMemo, useState} from 'react';
import {useNavigate} from 'react-router-dom';
import {PageHeader} from '@/components/shell/PageHeaderContext';
import {CreateWikiDialog} from '@/components/wiki/CreateWikiDialog';
import {WikiCard} from '@/components/wiki/WikiCard';
import {WikiSettingsDialog} from '@/components/wiki/WikiSettingsDialog';

/**
 * Wiki 列表页：归属"当前团队"的工作区以数据表形式展示（名称/简介/成员数/文档数/最近更新/
 * 创建时间），点行跳转到 Wiki 详情，行内保留置顶与设置两个操作（见 team-switcher spec.md
 * 「工作区以 Card 形式展示」，此处升级为表格以承载更多后台统计数据）。
 *
 * 顶部的"已置顶"分区刻意不受当前团队筛选，跨团队展示全部置顶工作区，仍用卡片做快捷入口
 * ——置顶的价值是"不管我在哪个团队下都能一键跳过去"，被当前团队筛掉就失去了这个价值
 * （见 team-switcher design.md 决策 3、spec.md「Wiki 列表页展示已置顶分区」）。
 */
export default function WikiList() {
  const navigate = useNavigate();
  const wikis = useWikiStore(state => state.wikis);
  const fetchWikis = useWikiStore(state => state.fetchWikis);
  const pinnedWikiIds = usePinnedStore(state => state.pinnedWikiIds);
  const togglePinWiki = usePinnedStore(state => state.togglePinWiki);
  const currentTeam = useCurrentTeam();
  const [createOpen, setCreateOpen] = useState(false);
  const [settingsWiki, setSettingsWiki] = useState<Wiki | null>(null);

  useEffect(() => {
    void fetchWikis();
  }, [fetchWikis]);

  // pinnedWikiIds 可能包含已经不在 wikis 里的陈旧 id（清理是异步的，fetchWikis 完成前有一个短暂窗口）；
  // 用 wikis 的顺序过滤一遍，保证这里展示的永远是"当前真实可见"的置顶工作区，不会渲染出裸 id。
  // 注意：这里故意不按当前团队筛选（跨团队展示），跟下方表格的筛选范围不同。
  const pinnedWikis = useMemo(
    () => wikis.filter(wiki => pinnedWikiIds.includes(wiki.id)),
    [wikis, pinnedWikiIds]
  );

  // 表格只展示归属当前团队的工作区；整个账号下没有任何 Wiki（跨团队都没有）跟
  // "当前团队下没有 Wiki 但其他团队有"是两种不同的空态，文案需要区分开，不能混用一句话。
  const teamWikis = useMemo(
    () => (currentTeam ? wikis.filter(wiki => wiki.teamId === currentTeam.id) : []),
    [wikis, currentTeam]
  );

  const columns: Array<DataTableColumn<Wiki>> = [
    {
      key: 'name',
      header: '名称',
      render: wiki => <span className="font-medium">{wiki.name}</span>
    },
    {
      key: 'description',
      header: '简介',
      className: 'max-w-[280px]',
      render: wiki => (
        <span className="block truncate text-muted-foreground">{wiki.description || '—'}</span>
      )
    },
    {
      key: 'members',
      header: '成员',
      className: 'text-right',
      render: wiki => <span className="tabular-nums">{wiki.memberCount ?? 0}</span>
    },
    {
      key: 'documents',
      header: '文档',
      className: 'text-right',
      render: wiki => <span className="tabular-nums">{wiki.documentCount ?? 0}</span>
    },
    {
      key: 'lastActivity',
      header: '最近更新',
      render: wiki => (
        <span className="text-muted-foreground">{relativeTime(wiki.lastActivityAt)}</span>
      )
    },
    {
      key: 'createdAt',
      header: '创建时间',
      render: wiki => <span className="text-muted-foreground">{formatDate(wiki.createdAt)}</span>
    },
    {
      key: 'actions',
      header: '',
      className: 'w-20 text-right',
      render: wiki => {
        const isPinned = pinnedWikiIds.includes(wiki.id);
        return (
          <div className="flex items-center justify-end gap-1">
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={isPinned ? '取消置顶' : '置顶'}
              onClick={e => {
                e.stopPropagation();
                togglePinWiki(wiki.id);
              }}
            >
              <Pin className={cn('size-3.5', isPinned && 'fill-current')} />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Wiki 设置"
              onClick={e => {
                e.stopPropagation();
                setSettingsWiki(wiki);
              }}
            >
              <Settings className="size-3.5" />
            </Button>
          </div>
        );
      }
    }
  ];

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
              <DataTable
                columns={columns}
                rows={teamWikis}
                rowKey={wiki => wiki.id}
                onRowClick={wiki => navigate(`/wiki/${wiki.id}`)}
              />
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
