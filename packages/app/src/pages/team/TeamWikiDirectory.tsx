import {ApiError} from '@luhanxin/api-client';
import type {TeamWikiDirectoryEntry} from '@luhanxin/core';
import {useTeamStore, useWikiStore} from '@luhanxin/core';
import {Button, DataTable, type DataTableColumn, EmptyState} from '@luhanxin/ui';
import {useEffect, useState} from 'react';
import {useNavigate, useParams} from 'react-router-dom';
import {PageHeader} from '@/components/shell/PageHeaderContext';

/**
 * 团队工作区目录：以数据表展示元信息（名称/简介/成员数/文档数），不含文档内容或成员名单——
 * 这是"仅元信息可见"边界在前端的体现（见 spec.md「团队成员可浏览团队内工作区目录」）。
 * 已是成员的直接展示"进入"，未开放申请的只展示提示，已开放申请的展示"申请加入"。
 */
export default function TeamWikiDirectory() {
  const {teamId} = useParams<{teamId: string}>();
  const navigate = useNavigate();
  const listTeamWikis = useTeamStore(state => state.listTeamWikis);
  const createJoinRequest = useWikiStore(state => state.createJoinRequest);

  const [wikis, setWikis] = useState<TeamWikiDirectoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [pendingWikiId, setPendingWikiId] = useState<string | null>(null);
  const [requestedIds, setRequestedIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!teamId) return;
    setLoading(true);
    listTeamWikis(teamId)
      .then(setWikis)
      .catch(() => setError('加载失败'))
      .finally(() => setLoading(false));
  }, [teamId, listTeamWikis]);

  async function handleRequestJoin(wikiId: string): Promise<void> {
    setPendingWikiId(wikiId);
    setError(null);
    try {
      await createJoinRequest(wikiId);
      setRequestedIds(prev => new Set(prev).add(wikiId));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '申请失败，请稍后重试');
    } finally {
      setPendingWikiId(null);
    }
  }

  const columns: Array<DataTableColumn<TeamWikiDirectoryEntry>> = [
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
      render: wiki => <span className="tabular-nums">{wiki.memberCount}</span>
    },
    {
      key: 'documents',
      header: '文档',
      className: 'text-right',
      render: wiki => <span className="tabular-nums">{wiki.documentCount}</span>
    },
    {
      key: 'actions',
      header: '',
      className: 'w-28 text-right',
      render: wiki => {
        if (wiki.isMember) {
          return (
            <Button variant="outline" size="sm" onClick={() => navigate(`/wiki/${wiki.id}`)}>
              进入
            </Button>
          );
        }
        if (wiki.allowJoinRequest) {
          return (
            <Button
              size="sm"
              disabled={pendingWikiId === wiki.id || requestedIds.has(wiki.id)}
              onClick={() => void handleRequestJoin(wiki.id)}
            >
              {requestedIds.has(wiki.id) ? '已申请' : '申请加入'}
            </Button>
          );
        }
        return <span className="text-xs text-muted-foreground">未开放申请</span>;
      }
    }
  ];

  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <PageHeader title="团队工作区" />

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {loading ? (
        <DataTable columns={columns} rows={[]} rowKey={wiki => wiki.id} loading />
      ) : wikis.length === 0 ? (
        <EmptyState title="暂无工作区" description="这个团队下还没有任何 Wiki" />
      ) : (
        <DataTable columns={columns} rows={wikis} rowKey={wiki => wiki.id} />
      )}
    </div>
  );
}
