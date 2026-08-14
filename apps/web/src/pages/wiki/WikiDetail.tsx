import {FilePlus} from 'lucide-react';
import {useEffect, useState} from 'react';
import {useNavigate, useParams} from 'react-router-dom';
import {toast} from 'sonner';
import {EmptyState} from '@/components/shared/EmptyState';
import {PageHeader} from '@/components/shell/PageHeaderContext';
import {Button} from '@/components/ui/button';
import {DocumentTreeList} from '@/components/wiki/DocumentTreeList';
import {buildDocumentTree} from '@/lib/document-tree';
import {ApiError} from '@/network';
import {useDocumentStore, useDocumentTree} from '@/store/document';
import {useTeamStore} from '@/store/team';
import type {Wiki, WikiRole} from '@/store/wiki';
import {useWikiStore} from '@/store/wiki';

/**
 * Wiki 详情页：展示该 Wiki 下的文档树，并提供创建顶层文档入口（见 wiki-document/document-editor
 * spec.md「Wiki 详情页展示真实文档树与创建入口」，替代此前"暂无文章"的固定占位）。
 *
 * 这里承担的关键职责是"跨团队打开静默跟随切换"——如果通过搜索结果/分享链接/直接访问 URL
 * 打开的这个 Wiki 归属的团队跟 Sidebar 当前选中的团队不一致，静默把 `currentTeamId` 切换
 * 过去，不弹确认提示，保持"感知不到硬切换"的体验（见 team-switcher spec.md「打开跨团队
 * 工作区时静默跟随切换」）。
 */
export default function WikiDetail() {
  const {wikiId} = useParams<{wikiId: string}>();
  const navigate = useNavigate();
  const getWiki = useWikiStore(state => state.getWiki);
  const currentTeamId = useTeamStore(state => state.currentTeamId);
  const setCurrentTeamId = useTeamStore(state => state.setCurrentTeamId);
  const documents = useDocumentTree(wikiId);
  const fetchDocuments = useDocumentStore(state => state.fetchDocuments);
  const createDocument = useDocumentStore(state => state.createDocument);

  const [wiki, setWiki] = useState<Wiki | null>(null);
  const [role, setRole] = useState<WikiRole | null>(null);

  useEffect(() => {
    if (!wikiId) return;
    getWiki(wikiId)
      .then(res => {
        setWiki(res.wiki);
        setRole(res.role);
      })
      .catch(() => {
        setWiki(null);
        setRole(null);
      });
    void fetchDocuments(wikiId);
  }, [wikiId, getWiki, fetchDocuments]);

  // 只在这个 Wiki 归属的团队跟当前团队不一致时才切换一次，避免每次渲染都触发 set
  // （wiki.teamId 变化才重新执行，正常浏览同一个 Wiki 时不会反复调用）。
  useEffect(() => {
    if (!wiki) return;
    if (wiki.teamId !== currentTeamId) setCurrentTeamId(wiki.teamId);
  }, [wiki, currentTeamId, setCurrentTeamId]);

  if (!wikiId) return null;

  const canCreate = role === 'OWNER' || role === 'EDITOR';
  const tree = buildDocumentTree(documents);

  async function handleCreate(): Promise<void> {
    // wikiId 在这里理应必定存在（组件顶部已经 `if (!wikiId) return null` 提前退出），
    // 但这个 narrowing 不会跨越嵌套函数边界传递给 TS——嵌套 function 是延迟调用的闭包，
    // TS 无法保证外部变量到实际调用时刻仍是同一个窄化后的值，因此在这里本地再判断一次。
    if (!wikiId) return;
    try {
      const document = await createDocument(wikiId, {});
      navigate(`/wiki/${wikiId}/documents/${document.id}`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '创建文档失败，请稍后重试');
    }
  }

  const createButton = canCreate ? (
    <Button onClick={() => void handleCreate()}>
      <FilePlus className="size-4" />
      新建文档
    </Button>
  ) : null;

  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <PageHeader title={wiki?.name ?? 'Wiki'} actions={createButton} />

      {tree.length === 0 ? (
        <EmptyState
          title="这个 Wiki 下还没有任何文档"
          description={canCreate ? '创建第一篇文档，开始记录内容' : '当前没有可查看的文档'}
          action={createButton}
        />
      ) : (
        <div className="max-w-md">
          <DocumentTreeList wikiId={wikiId} nodes={tree} />
        </div>
      )}
    </div>
  );
}
