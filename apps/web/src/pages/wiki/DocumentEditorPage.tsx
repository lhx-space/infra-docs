import type {HistoricalEditorInfo} from '@luhanxin/tiptap-editor';
import {DocumentEditor} from '@luhanxin/tiptap-editor';
import {History, Trash2} from 'lucide-react';
import {useEffect, useState} from 'react';
import {useNavigate, useParams} from 'react-router-dom';
import {toast} from 'sonner';
import {ConfirmDialog} from '@/components/shared/ConfirmDialog';
import {EmptyState} from '@/components/shared/EmptyState';
import {PageHeader} from '@/components/shell/PageHeaderContext';
import {Button} from '@/components/ui/button';
import {VersionHistoryDialog} from '@/components/wiki/VersionHistoryDialog';
import {useDocumentCollaboration} from '@/hooks/use-document-collaboration';
import {useOnlineStatus} from '@/hooks/use-online-status';
import {colorFromUserId} from '@/lib/collaboration-color';
import {ApiError} from '@/network';
import {useAuthStore} from '@/store/auth';
import type {Document} from '@/store/document';
import {useDocumentStore} from '@/store/document';
import {useProfileStore} from '@/store/profile';
import type {WikiRole} from '@/store/wiki';
import {useWikiStore} from '@/store/wiki';

/**
 * 文档编辑视图：挂载 `DocumentEditor`（大纲导航/全屏/图片上传/链接预览均由包内部
 * 提供），本页负责数据装配（拉取文档元信息 + 角色 + 实时协同连接）与页面级交互
 * （标题编辑、删除、版本历史入口）（见 wiki-document/document-editor spec.md、
 * yjs-realtime-collaboration design.md）。
 *
 * 正文内容的真源是协同连接驱动的 `Y.Doc`（`useDocumentCollaboration`），不再是
 * REST `GET /documents/:id` 返回的 `content` 字段——那个字段现在只是"物化只读
 * 视图"（见 design.md 决策 5），这里仍然拉一次只是为了拿标题/存在性/角色，不用于
 * 渲染正文。
 */
export default function DocumentEditorPage() {
  const {wikiId, documentId} = useParams<{wikiId: string; documentId: string}>();
  const navigate = useNavigate();
  const online = useOnlineStatus();
  const currentUser = useAuthStore(state => state.user);
  const currentProfile = useProfileStore(state => state.profile);

  const getWiki = useWikiStore(state => state.getWiki);
  const getDocument = useDocumentStore(state => state.getDocument);
  const patchDocumentTitleLocal = useDocumentStore(state => state.patchDocumentTitleLocal);
  const deleteDocument = useDocumentStore(state => state.deleteDocument);
  const uploadImage = useDocumentStore(state => state.uploadImage);
  const fetchLinkPreview = useDocumentStore(state => state.fetchLinkPreview);
  const uploadVideo = useDocumentStore(state => state.uploadVideo);
  const pollVideoStatus = useDocumentStore(state => state.pollVideoStatus);
  const listEditors = useDocumentStore(state => state.listEditors);

  const collaboration = useDocumentCollaboration(documentId);

  const [document_, setDocument] = useState<Document | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [role, setRole] = useState<WikiRole | null>(null);
  const [title, setTitle] = useState('');
  const [fullscreen, setFullscreen] = useState(false);
  const [versionHistoryOpen, setVersionHistoryOpen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [historicalEditors, setHistoricalEditors] = useState<HistoricalEditorInfo[]>([]);

  // online/reloadKey 都不在下面的函数体里被读取，只是用来"触发效果重新执行"的信号量——
  // online 变化时重新拉一次覆盖"网络恢复后自动恢复可编辑状态并重新拉取最新数据"
  // （见 document-editor spec.md），reloadKey 用于版本恢复后强制刷新。这类"只订阅变化、
  // 不使用值"的依赖，Biome 的 exhaustive-deps 检测不出用途，会误判为多余依赖建议删除，
  // 删掉后功能就会失效
  // biome-ignore lint/correctness/useExhaustiveDependencies: online/reloadKey 是有意的信号依赖，见上面注释
  useEffect(() => {
    if (!wikiId || !documentId) return;
    let cancelled = false;

    void getWiki(wikiId).then(
      res => {
        if (!cancelled) setRole(res.role);
      },
      () => {
        if (!cancelled) setRole(null);
      }
    );

    setNotFound(false);
    void getDocument(wikiId, documentId).then(doc => {
      if (cancelled) return;
      if (doc) {
        setDocument(doc);
        setTitle(doc.title);
      } else {
        setNotFound(true);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [wikiId, documentId, online, getWiki, getDocument, reloadKey]);

  // 历史编辑人：跟主数据加载分开、独立一个 effect——这是锦上添花的展示，失败或者慢
  // 都不应该影响文档主体的加载判断（`listEditors` 内部已经吞掉了错误，见 store/document.ts）
  useEffect(() => {
    if (!wikiId || !documentId) return;
    let cancelled = false;
    void listEditors(wikiId, documentId).then(editors => {
      if (cancelled) return;
      setHistoricalEditors(
        editors.map(editor => ({
          id: editor.id,
          name: editor.username,
          color: colorFromUserId(editor.id),
          avatarUrl: editor.avatarUrl
        }))
      );
    });
    return () => {
      cancelled = true;
    };
  }, [wikiId, documentId, listEditors]);

  const canEdit = role === 'OWNER' || role === 'EDITOR';
  const canRestoreVersion = role === 'OWNER';

  /**
   * 标题变化：协同模式下 `DocumentEditor` 内部已经把标题绑定到 Y.Doc 的一个共享
   * `XmlFragment`（见 collaborative-document-title design.md），多人编辑会 CRDT
   * 自动合并并由协同连接持久化——这里不再需要防抖 `PATCH`。
   *
   * 但仍然需要顺手同步一次 `store/document.ts` 的 `documentsByWiki`（`patchDocument
   * TitleLocal`，不发请求，纯本地替换）——否则 Sidebar 的文档树只从这份 store 读标题，
   * 标题改走 Y.Doc 之后这条链路被完全绕开了，会导致 Sidebar 一直停留在打开文档那一刻
   * 的旧标题（这个回调对本地输入和远程 CRDT 合并都会触发，见 DocumentEditor.tsx，
   * 所以这一步同时覆盖了"自己编辑"和"协作者同时打开着这篇文档"这两种情形；只停留在
   * Sidebar、没打开这篇文档的协作者不在这次覆盖范围内，那需要额外的轮询/推送机制）。
   */
  function handleTitleChange(next: string): void {
    setTitle(next);
    if (wikiId && documentId) patchDocumentTitleLocal(wikiId, documentId, next);
  }

  async function handleDelete(): Promise<void> {
    if (!wikiId || !documentId) return;
    setDeleting(true);
    try {
      await deleteDocument(wikiId, documentId);
      toast.success('已删除');
      setConfirmingDelete(false);
      navigate(`/wiki/${wikiId}`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '删除失败，请稍后重试');
    } finally {
      setDeleting(false);
    }
  }

  if (!wikiId || !documentId) return null;

  if (notFound) {
    return (
      <div className="flex flex-1 flex-col p-6">
        <PageHeader title="文档" />
        <EmptyState
          title="内容当前不可用"
          description={
            online
              ? '这篇文档不存在，或你没有访问权限'
              : '当前处于离线状态，且本地没有缓存过这篇文档的内容'
          }
        />
      </div>
    );
  }

  if (!document_ || !collaboration || !currentUser) {
    return (
      <div className="flex flex-1 flex-col p-6">
        <PageHeader title="文档" />
        <p className="p-6 text-sm text-muted-foreground">加载中...</p>
      </div>
    );
  }

  const headerActions = (
    <div className="flex items-center gap-2">
      <Button variant="ghost" size="sm" onClick={() => setVersionHistoryOpen(true)}>
        <History className="size-4" />
        版本历史
      </Button>
      {role === 'OWNER' ? (
        <Button variant="ghost" size="sm" onClick={() => setConfirmingDelete(true)}>
          <Trash2 className="size-4" />
          删除
        </Button>
      ) : null}
    </div>
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      {!fullscreen ? <PageHeader title={title || '未命名文档'} actions={headerActions} /> : null}

      <div className="min-h-0 flex-1">
        <DocumentEditor
          key={`${documentId}-${reloadKey}`}
          editable={canEdit}
          offline={!online}
          title={title}
          onTitleChange={handleTitleChange}
          uploadImage={uploadImage}
          onImageUploadError={message => toast.error(message)}
          fetchLinkPreview={fetchLinkPreview}
          uploadVideo={uploadVideo}
          pollVideoStatus={pollVideoStatus}
          onVideoUploadError={message => toast.error(message)}
          collaboration={{
            document: collaboration.document,
            provider: collaboration.provider,
            user: {
              name: currentUser.username,
              color: colorFromUserId(currentUser.id),
              avatarUrl: currentProfile?.avatarUrl
            }
          }}
          collaborationStatus={collaboration.status}
          onReconnect={collaboration.reconnect}
          historicalEditors={historicalEditors}
          fullscreen={fullscreen}
          onFullscreenChange={setFullscreen}
          className="h-full"
        />
      </div>

      {/* 全屏切换按钮已经是 `DocumentEditor` 自带工具栏的一部分（传了 `onFullscreenChange`
          就会渲染），这里不重复放一个 */}

      <VersionHistoryDialog
        wikiId={wikiId}
        documentId={documentId}
        open={versionHistoryOpen}
        onOpenChange={setVersionHistoryOpen}
        canRestore={canRestoreVersion}
        onRestored={() => setReloadKey(key => key + 1)}
      />

      <ConfirmDialog
        open={confirmingDelete}
        onOpenChange={setConfirmingDelete}
        title="删除文档"
        description="删除后该文档及其全部子文档、历史版本都无法恢复，确认删除吗？"
        loading={deleting}
        onConfirm={() => void handleDelete()}
      />
    </div>
  );
}
