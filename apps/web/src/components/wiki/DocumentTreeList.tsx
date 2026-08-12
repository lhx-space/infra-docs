import {FileText, Plus, Trash2} from 'lucide-react';
import {useState} from 'react';
import {Link, useLocation, useNavigate} from 'react-router-dom';
import {toast} from 'sonner';
import {ConfirmDialog} from '@/components/shared/ConfirmDialog';
import type {DocumentTreeNode} from '@/lib/document-tree';
import {cn} from '@/lib/utils';
import {ApiError} from '@/network';
import {useDocumentStore} from '@/store/document';

interface DocumentTreeListProps {
  wikiId: string;
  nodes: DocumentTreeNode[];
  depth?: number;
}

/**
 * 递归渲染文档树，`Sidebar`/`WikiDetail` 共用（见 document-editor spec.md「Sidebar 展示可
 * 展开的文档树」）。每个节点 hover 时露出两个操作：基于当前文档新建子文档、删除当前文档
 * （及其全部子文档），不需要先打开文档详情页才能操作（见 document-editor spec.md
 * 「文档树里的创建子文档与删除」）。
 *
 * 删除走自定义的 `ConfirmDialog`，不用原生 `window.confirm()`——原生确认框样式不可控、
 * 不跟随深色模式，跟应用里其他弹窗视觉断层（见 document-editor spec.md「删除前的二次
 * 确认」）。这个组件是递归自调用的，`pendingDeleteId`/`deleting` 这两个状态每一层递归各自
 * 持有一份，弹窗只会在触发删除的那一层渲染，互不影响。
 */
export function DocumentTreeList({wikiId, nodes, depth = 0}: DocumentTreeListProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const createDocument = useDocumentStore(state => state.createDocument);
  const deleteDocument = useDocumentStore(state => state.deleteDocument);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  if (nodes.length === 0) return null;

  async function handleCreateChild(parentId: string): Promise<void> {
    try {
      const document = await createDocument(wikiId, {parentId});
      navigate(`/wiki/${wikiId}/documents/${document.id}`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '创建子文档失败，请稍后重试');
    }
  }

  async function handleDelete(): Promise<void> {
    if (!pendingDeleteId) return;
    const nodeId = pendingDeleteId;
    setDeleting(true);
    try {
      await deleteDocument(wikiId, nodeId);
      toast.success('已删除');
      setPendingDeleteId(null);
      // 删除的正好是当前打开的文档时，跳回 Wiki 详情页，不留在一个已经不存在的文档页面上
      if (location.pathname === `/wiki/${wikiId}/documents/${nodeId}`) {
        navigate(`/wiki/${wikiId}`);
      }
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '删除失败，请稍后重试');
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="flex flex-col gap-0.5">
      {nodes.map(node => {
        const path = `/wiki/${wikiId}/documents/${node.id}`;
        const active = location.pathname === path;
        return (
          <div key={node.id}>
            <div
              className={cn(
                'group flex items-center gap-1 rounded-md border-l-2 border-transparent pr-1 hover:bg-sidebar-accent',
                active && 'border-sidebar-primary bg-sidebar-accent'
              )}
            >
              <Link
                to={path}
                style={{paddingLeft: `${depth * 12 + 8}px`}}
                className={cn(
                  'flex min-w-0 flex-1 items-center gap-2 truncate py-1.5 text-sm text-muted-foreground',
                  active && 'font-medium text-foreground'
                )}
              >
                <FileText className="size-3.5 shrink-0" />
                <span className="truncate">{node.title}</span>
              </Link>
              <button
                type="button"
                onClick={() => void handleCreateChild(node.id)}
                aria-label="新建子文档"
                className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 hover:bg-background group-hover:opacity-100"
              >
                <Plus className="size-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setPendingDeleteId(node.id)}
                aria-label="删除文档"
                className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 hover:bg-background group-hover:opacity-100"
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
            {node.children.length > 0 ? (
              <DocumentTreeList wikiId={wikiId} nodes={node.children} depth={depth + 1} />
            ) : null}
          </div>
        );
      })}

      <ConfirmDialog
        open={pendingDeleteId !== null}
        onOpenChange={open => !open && setPendingDeleteId(null)}
        title="删除文档"
        description="删除后该文档及其全部子文档、历史版本都无法恢复，确认删除吗？"
        loading={deleting}
        onConfirm={() => void handleDelete()}
      />
    </div>
  );
}
