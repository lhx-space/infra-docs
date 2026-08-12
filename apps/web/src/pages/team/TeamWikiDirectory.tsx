import {useEffect, useState} from 'react';
import {Link, useParams} from 'react-router-dom';
import {EmptyState} from '@/components/shared/EmptyState';
import {PageHeader} from '@/components/shell/PageHeaderContext';
import {Button} from '@/components/ui/button';
import {ApiError} from '@/network';
import type {TeamWikiDirectoryEntry} from '@/store/team';
import {useTeamStore} from '@/store/team';
import {useWikiStore} from '@/store/wiki';

/**
 * 团队工作区目录：只展示元信息（名称/简介/封面），不包含文档内容或成员名单——
 * 这是"仅元信息可见"边界在前端的体现（见 spec.md「团队成员可浏览团队内工作区目录」）。
 * 已是成员的直接展示"进入"，未开放申请的只展示提示，已开放申请的展示"申请加入"。
 */
export default function TeamWikiDirectory() {
  const {teamId} = useParams<{teamId: string}>();
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

  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <PageHeader title="团队工作区" />

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {loading ? (
        <p className="py-8 text-center text-sm text-muted-foreground">加载中...</p>
      ) : wikis.length === 0 ? (
        <EmptyState title="暂无工作区" description="这个团队下还没有任何 Wiki" />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {wikis.map(wiki => (
            <div key={wiki.id} className="flex flex-col gap-3 rounded-lg border p-3">
              <div className="aspect-video overflow-hidden rounded-md bg-muted">
                {wiki.coverImage ? (
                  <img src={wiki.coverImage} alt={wiki.name} className="size-full object-cover" />
                ) : null}
              </div>
              <p className="truncate text-sm font-medium">{wiki.name}</p>
              {wiki.description ? (
                <p className="line-clamp-2 text-xs text-muted-foreground">{wiki.description}</p>
              ) : null}
              {wiki.isMember ? (
                <Link to={`/wiki/${wiki.id}`}>
                  <Button variant="outline" size="sm" className="w-full">
                    进入
                  </Button>
                </Link>
              ) : wiki.allowJoinRequest ? (
                <Button
                  size="sm"
                  disabled={pendingWikiId === wiki.id || requestedIds.has(wiki.id)}
                  onClick={() => void handleRequestJoin(wiki.id)}
                >
                  {requestedIds.has(wiki.id) ? '已申请' : '申请加入'}
                </Button>
              ) : (
                <p className="text-xs text-muted-foreground">未开放申请</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
