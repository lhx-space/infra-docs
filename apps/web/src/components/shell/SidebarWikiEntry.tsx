import {ChevronRight, FilePlus, Loader2} from 'lucide-react';
import {useEffect, useState} from 'react';
import {Link, useLocation, useNavigate} from 'react-router-dom';
import {toast} from 'sonner';
import {Button} from '@/components/ui/button';
import {DocumentTreeList} from '@/components/wiki/DocumentTreeList';
import {buildDocumentTree} from '@/lib/document-tree';
import {cn} from '@/lib/utils';
import {ApiError} from '@/network';
import {useDocumentStore, useDocumentTree} from '@/store/document';
import type {Wiki} from '@/store/wiki';

interface SidebarWikiEntryProps {
  wiki: Wiki;
}

/**
 * Sidebar 里单个 Wiki 条目：展开/收起显示文档树（见 document-editor spec.md「Sidebar 展示
 * 可展开的文档树」）。展开时若本地还没有缓存过文档列表才发起一次拉取，避免重复展开/收起
 * 反复请求。当前路由落在这个 Wiki 下（比如从全局搜索点开某篇文档）时自动展开，不需要
 * 用户再手动点一次——不然搜索跳转过去后，Sidebar 里根本看不出当前文档在树里的哪个位置
 * （见 wiki-search spec.md「搜索结果联动 Sidebar 展开」）。
 */
export function SidebarWikiEntry({wiki}: SidebarWikiEntryProps) {
  const location = useLocation();
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const documents = useDocumentTree(wiki.id);
  const fetchDocuments = useDocumentStore(state => state.fetchDocuments);
  const createDocument = useDocumentStore(state => state.createDocument);
  const navigate = useNavigate();

  const isCurrentWiki =
    location.pathname === `/wiki/${wiki.id}` || location.pathname.startsWith(`/wiki/${wiki.id}/`);
  // 单独区分"正停在 Wiki 详情页本身"（行高亮）和"里面某篇文档打开着"（isCurrentWiki，
  // 只用来触发自动展开）——文档本身已经在 DocumentTreeList 里高亮过一次，Wiki 行不需要
  // 跟着重复高亮，否则视觉上分不清到底是 Wiki 还是文档处于当前位置
  const isWikiDetailActive = location.pathname === `/wiki/${wiki.id}`;

  useEffect(() => {
    if (isCurrentWiki) setExpanded(true);
    // 只在"路由刚进入这个 Wiki"这一刻自动展开一次，之后用户手动收起就不再强制掰开——
    // 依赖数组只放 isCurrentWiki，不放 wiki.id（同一个 Wiki 实例整个生命周期内 id 不变）
  }, [isCurrentWiki]);

  // 只依赖 `expanded`：避免 documents/loading 变化时重复触发拉取判断（这里用的是 Biome
  // 而不是 ESLint，`eslint-disable-next-line` 这类注释对 Biome 没有任何抑制效果，之前那行
  // 纯粹是摆设，警告一直都在触发；biome-ignore 必须写在被检查的语句正上方才生效，不能写
  // 在依赖数组那一行前面）
  // biome-ignore lint/correctness/useExhaustiveDependencies: 有意只依赖 expanded
  useEffect(() => {
    if (expanded && documents.length === 0 && !loading) {
      setLoading(true);
      void fetchDocuments(wiki.id).finally(() => setLoading(false));
    }
  }, [expanded]);

  function toggleExpand(): void {
    setExpanded(prev => !prev);
  }

  async function handleCreate(): Promise<void> {
    try {
      const document = await createDocument(wiki.id, {});
      navigate(`/wiki/${wiki.id}/documents/${document.id}`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '创建文档失败，请稍后重试');
    }
  }

  const tree = buildDocumentTree(documents);

  return (
    <div>
      <div
        className={cn(
          'group flex items-center gap-1 rounded-md border-l-2 border-transparent pr-1 hover:bg-sidebar-accent',
          isWikiDetailActive && 'border-sidebar-primary bg-sidebar-accent'
        )}
      >
        <button
          type="button"
          onClick={toggleExpand}
          aria-label={expanded ? '收起文档树' : '展开文档树'}
          className="flex size-6 shrink-0 items-center justify-center text-muted-foreground"
        >
          <ChevronRight className={cn('size-3.5 transition-transform', expanded && 'rotate-90')} />
        </button>
        <Link
          to={`/wiki/${wiki.id}`}
          className={cn(
            'flex min-w-0 flex-1 items-center truncate py-1.5 text-sm text-muted-foreground',
            isWikiDetailActive && 'font-medium text-foreground'
          )}
        >
          <span className="truncate">{wiki.name}</span>
        </Link>
        <Button
          variant="ghost"
          size="icon-xs"
          className="opacity-0 group-hover:opacity-100"
          onClick={() => void handleCreate()}
          aria-label="新建文档"
        >
          <FilePlus className="size-3.5" />
        </Button>
      </div>

      {expanded ? (
        loading ? (
          <div className="flex items-center gap-2 px-4 py-1.5 text-xs text-muted-foreground">
            <Loader2 className="size-3 animate-spin" />
            加载中...
          </div>
        ) : tree.length > 0 ? (
          <DocumentTreeList wikiId={wiki.id} nodes={tree} depth={1} />
        ) : (
          <div className="flex items-center justify-between px-4 py-1.5 text-xs text-muted-foreground">
            <span>暂无文档</span>
            <button
              type="button"
              onClick={() => void handleCreate()}
              className="text-primary hover:underline"
            >
              新建
            </button>
          </div>
        )
      ) : null}
    </div>
  );
}
