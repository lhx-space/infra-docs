import {http} from '@/network';

export interface Document {
  id: string;
  wikiId: string;
  parentId: string | null;
  title: string;
  content: unknown;
  searchText: string;
  coverImage: string | null;
  order: number;
  createdAt: string;
  updatedAt: string;
}

export interface DocumentVersion {
  id: string;
  documentId: string;
  title: string;
  content: unknown;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateDocumentInput {
  parentId?: string | null;
  title?: string;
  coverImage?: string;
}

export interface UpdateDocumentInput {
  title?: string;
  content?: unknown;
  coverImage?: string;
  parentId?: string | null;
  order?: number;
}

/**
 * 对 `/wikis/:wikiId/documents` 系列接口的薄封装，风格对齐 `services/wiki.ts`：只负责
 * "发请求、拿结果"，不做错误码翻译（翻译交给调用方 `store/document.ts`），不依赖 zustand。
 */
export function listDocuments(wikiId: string): Promise<{documents: Document[]}> {
  return http.get<{documents: Document[]}>(`/wikis/${wikiId}/documents`);
}

export function getDocument(wikiId: string, documentId: string): Promise<{document: Document}> {
  return http.get<{document: Document}>(`/wikis/${wikiId}/documents/${documentId}`);
}

export function createDocument(
  wikiId: string,
  input: CreateDocumentInput
): Promise<{document: Document}> {
  return http.post<{document: Document}>(`/wikis/${wikiId}/documents`, input);
}

export function updateDocument(
  wikiId: string,
  documentId: string,
  input: UpdateDocumentInput
): Promise<{document: Document}> {
  return http.patch<{document: Document}>(`/wikis/${wikiId}/documents/${documentId}`, input);
}

export function deleteDocument(wikiId: string, documentId: string): Promise<{status: string}> {
  return http.delete<{status: string}>(`/wikis/${wikiId}/documents/${documentId}`);
}

export function listVersions(
  wikiId: string,
  documentId: string
): Promise<{versions: DocumentVersion[]}> {
  return http.get<{versions: DocumentVersion[]}>(
    `/wikis/${wikiId}/documents/${documentId}/versions`
  );
}

export function restoreVersion(
  wikiId: string,
  documentId: string,
  versionId: string
): Promise<{document: Document}> {
  return http.post<{document: Document}>(
    `/wikis/${wikiId}/documents/${documentId}/versions/${versionId}/restore`
  );
}
