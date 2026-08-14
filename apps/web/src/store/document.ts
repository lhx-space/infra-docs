import {create} from 'zustand';
import {getCache, offlineCacheKeys, setCache} from '@/lib/offline-cache';
import type {
  CreateDocumentInput,
  Document,
  DocumentEditor,
  DocumentVersion,
  UpdateDocumentInput
} from '@/services/document';
import * as documentService from '@/services/document';
import type {LinkPreviewResult} from '@/services/link-preview';
import * as linkPreviewService from '@/services/link-preview';
import * as uploadService from '@/services/upload';
import type {UploadVideoResult, VideoStatusResult} from '@/services/video';
import * as videoService from '@/services/video';

export type {CreateDocumentInput, Document, DocumentEditor, DocumentVersion, UpdateDocumentInput};

interface DocumentState {
  /** 按 wikiId 缓存的文档树（平铺列表，消费方自己按 parentId 组装层级），
   * `Sidebar`/`WikiDetail` 共享同一份数据，避免重复拉取（跟 `store/wiki.ts` 的思路一致） */
  documentsByWiki: Record<string, Document[]>;
  loadingWikiId: string | null;

  fetchDocuments: (wikiId: string) => Promise<Document[]>;
  /** 登出/切换账号时调用（见 `store/auth.ts` 的 `clearSession`，跟 `store/wiki.ts`
   * 的 `reset` 是同一个理由）：清空按 wikiId 缓存的文档树，避免新账号登录后在还没打开
   * 任何 Wiki 之前，`WikiDetail`/`Sidebar` 里恰好复用了同一个 wikiId 时展示出上一个
   * 用户遗留下来的文档树。 */
  reset: () => void;
  createDocument: (wikiId: string, input: CreateDocumentInput) => Promise<Document>;
  updateDocument: (
    wikiId: string,
    documentId: string,
    input: UpdateDocumentInput
  ) => Promise<Document>;
  /** 供协同标题场景使用（见 collaborative-document-title 之后新发现的 Sidebar 不同步
   * 问题）：标题现在的持久化真源是 Y.Doc（经 collab-server 周期性落库），不再走这里的
   * `updateDocument` REST 调用，所以 Sidebar/`documentsByWiki` 缓存不会再被自动同步。
   * 这个 action 不发任何请求，只在本地把 `documentsByWiki` 里对应文档节点的 `title`
   * 就地替换掉（写法照抄 `updateDocument`/`restoreVersion` 已有的 `.map()` 模式），
   * 供 `DocumentEditor` 的 `onTitleChange`（本地输入和远程 CRDT 合并都会触发）调用，
   * 让 Sidebar 感知到协同标题的变化。目标 wikiId 尚未拉取过文档树时（`documentsByWiki`
   * 里没有这个 key）安全地什么都不做——没有可更新的数组，也不需要凭空创建一个。 */
  patchDocumentTitleLocal: (wikiId: string, documentId: string, title: string) => void;
  deleteDocument: (wikiId: string, documentId: string) => Promise<void>;
  /** 离线（或请求失败）时自动降级读取本地 IndexedDB 缓存（见 document-editor spec.md
   * 「离线只读缓存」），成功拉取到的内容会写回缓存，供下次离线时使用 */
  getDocument: (wikiId: string, documentId: string) => Promise<Document | null>;
  listVersions: (wikiId: string, documentId: string) => Promise<DocumentVersion[]>;
  restoreVersion: (wikiId: string, documentId: string, versionId: string) => Promise<Document>;
  /** 曾经编辑过这篇文档的人（不要求当前在线），供标题旁展示历史编辑人（见体验优化，
   * yjs-realtime-collaboration tasks.md 追加项）；失败时静默返回空数组，这只是一个
   * 锦上添花的展示，不应该因为这一个接口失败影响整个文档打开流程 */
  listEditors: (wikiId: string, documentId: string) => Promise<DocumentEditor[]>;
  /** 传给 `DocumentEditor` 的 `uploadImage`/`fetchLinkPreview` 回调，风格对齐
   * `store/wiki.ts` 的 `uploadCoverImage`——组件不直接 import services，统一走 store */
  uploadImage: (file: File) => Promise<string>;
  fetchLinkPreview: (url: string) => Promise<LinkPreviewResult | null>;
  /** 传给 `DocumentEditor` 的 `uploadVideo`/`pollVideoStatus` 回调（见 video-transcoding
   * spec.md），跟图片上传是同一个分工：组件不直接 import services */
  uploadVideo: (file: File) => Promise<UploadVideoResult>;
  pollVideoStatus: (assetId: string) => Promise<VideoStatusResult>;
}

export const useDocumentStore = create<DocumentState>((set, get) => ({
  documentsByWiki: {},
  loadingWikiId: null,

  fetchDocuments: async wikiId => {
    set({loadingWikiId: wikiId});
    try {
      const {documents} = await documentService.listDocuments(wikiId);
      set(state => ({documentsByWiki: {...state.documentsByWiki, [wikiId]: documents}}));
      void setCache(offlineCacheKeys.documentTree(wikiId), documents);
      return documents;
    } catch (err) {
      const cached = await getCache<Document[]>(offlineCacheKeys.documentTree(wikiId));
      if (cached) {
        set(state => ({documentsByWiki: {...state.documentsByWiki, [wikiId]: cached}}));
        return cached;
      }
      throw err;
    } finally {
      set({loadingWikiId: null});
    }
  },

  reset: () => set({documentsByWiki: {}, loadingWikiId: null}),

  createDocument: async (wikiId, input) => {
    const {document} = await documentService.createDocument(wikiId, input);
    set(state => ({
      documentsByWiki: {
        ...state.documentsByWiki,
        [wikiId]: [...(state.documentsByWiki[wikiId] ?? []), document]
      }
    }));
    return document;
  },

  updateDocument: async (wikiId, documentId, input) => {
    const {document} = await documentService.updateDocument(wikiId, documentId, input);
    set(state => ({
      documentsByWiki: {
        ...state.documentsByWiki,
        [wikiId]: (state.documentsByWiki[wikiId] ?? []).map(d =>
          d.id === documentId ? document : d
        )
      }
    }));
    void setCache(offlineCacheKeys.document(documentId), document);
    return document;
  },

  patchDocumentTitleLocal: (wikiId, documentId, title) => {
    set(state => {
      const documents = state.documentsByWiki[wikiId];
      if (!documents) return state;
      return {
        documentsByWiki: {
          ...state.documentsByWiki,
          [wikiId]: documents.map(d => (d.id === documentId ? {...d, title} : d))
        }
      };
    });
  },

  // 删除会级联清空多层子文档（见后端 spec.md「级联删除」），本地缓存直接重新拉取一次，
  // 不在前端手写"递归找出所有子孙节点再过滤"的逻辑，正确性优先于省一次请求。
  deleteDocument: async (wikiId, documentId) => {
    await documentService.deleteDocument(wikiId, documentId);
    await get().fetchDocuments(wikiId);
  },

  getDocument: async (wikiId, documentId) => {
    try {
      const {document} = await documentService.getDocument(wikiId, documentId);
      void setCache(offlineCacheKeys.document(documentId), document);
      return document;
    } catch (err) {
      const cached = await getCache<Document>(offlineCacheKeys.document(documentId));
      if (cached) return cached;
      // 离线且缓存里没有目标文档：不抛出让调用方渲染空白/崩溃，返回 null 由页面展示
      // "内容当前不可用"（见 spec.md「离线时打开从未浏览过的文档」）
      if (!navigator.onLine) return null;
      throw err;
    }
  },

  listVersions: (wikiId, documentId) =>
    documentService.listVersions(wikiId, documentId).then(res => res.versions),

  restoreVersion: async (wikiId, documentId, versionId) => {
    const {document} = await documentService.restoreVersion(wikiId, documentId, versionId);
    set(state => ({
      documentsByWiki: {
        ...state.documentsByWiki,
        [wikiId]: (state.documentsByWiki[wikiId] ?? []).map(d =>
          d.id === documentId ? document : d
        )
      }
    }));
    return document;
  },

  listEditors: async (wikiId, documentId) => {
    try {
      const {editors} = await documentService.listEditors(wikiId, documentId);
      return editors;
    } catch {
      return [];
    }
  },

  uploadImage: async file => {
    const {url} = await uploadService.uploadImage(file);
    return url;
  },

  fetchLinkPreview: async url => {
    const result = await linkPreviewService.fetchLinkPreview(url);
    return result.available ? result : null;
  },

  uploadVideo: videoService.uploadVideo,
  pollVideoStatus: videoService.getVideoStatus
}));

// 稳定的空数组引用：selector 在状态未变化时必须返回同一个引用，否则
// `useSyncExternalStore` 会认为每次渲染快照都"变了"，从而无限重渲染
// （报错：Maximum update depth exceeded / getSnapshot should be cached）。
const EMPTY_DOCUMENTS: Document[] = [];

/** `Sidebar`/`WikiDetail` 展示文档树用这个，不需要重复写 `documentsByWiki[wikiId] ?? []` */
export function useDocumentTree(wikiId: string | undefined): Document[] {
  return useDocumentStore(state =>
    wikiId ? (state.documentsByWiki[wikiId] ?? EMPTY_DOCUMENTS) : EMPTY_DOCUMENTS
  );
}
