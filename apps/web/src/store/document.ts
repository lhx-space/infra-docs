import {create} from 'zustand';
import {getCache, offlineCacheKeys, setCache} from '@/lib/offline-cache';
import type {
  CreateDocumentInput,
  Document,
  DocumentVersion,
  UpdateDocumentInput
} from '@/services/document';
import * as documentService from '@/services/document';
import type {LinkPreviewResult} from '@/services/link-preview';
import * as linkPreviewService from '@/services/link-preview';
import * as uploadService from '@/services/upload';

export type {CreateDocumentInput, Document, DocumentVersion, UpdateDocumentInput};

interface DocumentState {
  /** 按 wikiId 缓存的文档树（平铺列表，消费方自己按 parentId 组装层级），
   * `Sidebar`/`WikiDetail` 共享同一份数据，避免重复拉取（跟 `store/wiki.ts` 的思路一致） */
  documentsByWiki: Record<string, Document[]>;
  loadingWikiId: string | null;

  fetchDocuments: (wikiId: string) => Promise<Document[]>;
  createDocument: (wikiId: string, input: CreateDocumentInput) => Promise<Document>;
  updateDocument: (
    wikiId: string,
    documentId: string,
    input: UpdateDocumentInput
  ) => Promise<Document>;
  deleteDocument: (wikiId: string, documentId: string) => Promise<void>;
  /** 离线（或请求失败）时自动降级读取本地 IndexedDB 缓存（见 document-editor spec.md
   * 「离线只读缓存」），成功拉取到的内容会写回缓存，供下次离线时使用 */
  getDocument: (wikiId: string, documentId: string) => Promise<Document | null>;
  listVersions: (wikiId: string, documentId: string) => Promise<DocumentVersion[]>;
  restoreVersion: (wikiId: string, documentId: string, versionId: string) => Promise<Document>;
  /** 传给 `DocumentEditor` 的 `uploadImage`/`fetchLinkPreview` 回调，风格对齐
   * `store/wiki.ts` 的 `uploadCoverImage`——组件不直接 import services，统一走 store */
  uploadImage: (file: File) => Promise<string>;
  fetchLinkPreview: (url: string) => Promise<LinkPreviewResult | null>;
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

  uploadImage: async file => {
    const {url} = await uploadService.uploadImage(file);
    return url;
  },

  fetchLinkPreview: async url => {
    const result = await linkPreviewService.fetchLinkPreview(url);
    return result.available ? result : null;
  }
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
