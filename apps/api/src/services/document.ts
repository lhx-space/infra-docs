import {prisma} from '../db/prisma';
import type {Document, DocumentVersion, Prisma} from '../generated/prisma/client';
import {
  createDocument as createDocumentModel,
  deleteDocument as deleteDocumentModel,
  findDocumentById,
  listDocumentsByWikiId as listDocumentsByWikiIdModel,
  listSiblingDocuments,
  reorderDocuments,
  searchDocuments as searchDocumentsModel,
  type UpdateDocumentInput as UpdateDocumentModelInput,
  updateDocument as updateDocumentModel
} from '../models/document';
import {buildDicebearUrl} from '../utils/dicebear';
import * as documentVersionService from './document-version';

/** 风格对齐 services/wiki.ts 的 WikiError：status + message，handler 层统一映射成 HTTP 状态码 */
export class DocumentError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'DocumentError';
    this.status = status;
  }
}

const DEFAULT_TITLE = '未命名文档';
const DEFAULT_CONTENT: Prisma.InputJsonValue = {
  type: 'doc',
  content: [{type: 'paragraph'}]
};

/**
 * 从 ProseMirror JSON 递归提取全部文本节点，拼接成纯文本供搜索使用
 * （见 wiki-document spec.md「保存时同步维护搜索用纯文本字段」）。
 * 只信任 `text` 属性本身，不假设节点类型白名单——未知节点类型的合法性由内容安全校验
 * （services/document-schema.ts）单独负责，这里只做纯文本抽取。
 */
export function extractPlainText(node: unknown): string {
  if (node === null || typeof node !== 'object') return '';
  const n = node as {text?: unknown; content?: unknown};
  const parts: string[] = [];
  if (typeof n.text === 'string') parts.push(n.text);
  if (Array.isArray(n.content)) {
    for (const child of n.content) {
      const text = extractPlainText(child);
      if (text) parts.push(text);
    }
  }
  return parts.join(' ');
}

async function assertParentBelongsToWiki(
  wikiId: string,
  parentId: string | null | undefined
): Promise<void> {
  if (!parentId) return;
  const parent = await findDocumentById(parentId);
  if (!parent || parent.wikiId !== wikiId) {
    throw new DocumentError(400, 'invalid_input');
  }
}

function clampOrderIndex(order: number | undefined, siblingCount: number): number {
  if (order === undefined) return siblingCount;
  return Math.max(0, Math.min(order, siblingCount));
}

export interface CreateDocumentInput {
  parentId?: string | null;
  title?: string;
  coverImage?: string;
}

/**
 * 创建文档：未指定 `parentId` 视为顶层文档；跨 Wiki 指定父文档拒绝（400，见 spec.md
 * 「跨 Wiki 指定父文档被拒绝」）；未提供内容时用单个空段落兜底，未上传封面图时复用
 * Wiki 同款 DiceBear 规则按标题生成（见 spec.md「文档封面图」）；新文档追加到同级末尾。
 */
export async function createDocument(
  wikiId: string,
  input: CreateDocumentInput
): Promise<Document> {
  const parentId = input.parentId ?? null;
  await assertParentBelongsToWiki(wikiId, parentId);

  const title = input.title?.trim() || DEFAULT_TITLE;
  const coverImage = input.coverImage ?? buildDicebearUrl('shapes', title);
  const siblings = await listSiblingDocuments(wikiId, parentId);

  return createDocumentModel({
    wikiId,
    parentId,
    title,
    content: DEFAULT_CONTENT,
    coverImage,
    order: siblings.length
  });
}

export function listDocuments(wikiId: string): Promise<Document[]> {
  return listDocumentsByWikiIdModel(wikiId);
}

export async function getDocument(wikiId: string, documentId: string): Promise<Document> {
  const doc = await findDocumentById(documentId);
  if (!doc || doc.wikiId !== wikiId) {
    throw new DocumentError(404, 'not_found');
  }
  return doc;
}

export interface UpdateDocumentInput {
  title?: string;
  /** 已通过服务端结构校验（services/document-schema.ts）的 ProseMirror JSON */
  content?: unknown;
  coverImage?: string;
  parentId?: string | null;
  order?: number;
}

/**
 * 保存文档：`content` 变化时同步派生 `searchText`（客户端即使传入同名字段也会被这里
 * 忽略，因为 UpdateDocumentInput 根本不接收它，见 spec.md「客户端传入的字段被忽略」）并
 * 按编辑会话聚合规则写入一条版本快照（见 document-versioning spec.md）；`parentId`/`order`
 * 任一变化都在目标同级列表内重新排序并全量重新赋值（见 design.md 决策 1）；采用
 * Last-Write-Wins，不做并发锁（见 spec.md「保存采用后写覆盖策略」）。
 *
 * `userId` 只有 `content` 变化时才会被用到（作为该次版本快照的 `createdBy`），纯改
 * 标题/封面/移动位置不产生版本记录。
 */
export async function updateDocument(
  wikiId: string,
  documentId: string,
  input: UpdateDocumentInput,
  userId: string
): Promise<Document> {
  const existing = await getDocument(wikiId, documentId);

  if (input.parentId !== undefined && input.parentId === documentId) {
    throw new DocumentError(400, 'invalid_input');
  }
  const nextParentId = input.parentId !== undefined ? input.parentId : existing.parentId;
  if (input.parentId !== undefined) {
    await assertParentBelongsToWiki(wikiId, input.parentId);
  }

  const data: UpdateDocumentModelInput = {};
  if (input.title !== undefined) data.title = input.title;
  if (input.coverImage !== undefined) data.coverImage = input.coverImage;
  const nextTitle = input.title ?? existing.title;
  if (input.content !== undefined) {
    data.content = input.content as Prisma.InputJsonValue;
    data.searchText = extractPlainText(input.content);
    await documentVersionService.snapshotVersion(
      documentId,
      nextTitle,
      input.content as Prisma.InputJsonValue,
      userId
    );
  }

  const parentChanged = input.parentId !== undefined && input.parentId !== existing.parentId;
  if (parentChanged || input.order !== undefined) {
    return prisma.$transaction(async tx => {
      const siblings = (await listSiblingDocuments(wikiId, nextParentId, tx)).filter(
        d => d.id !== documentId
      );
      const targetIndex = clampOrderIndex(input.order, siblings.length);
      siblings.splice(targetIndex, 0, existing);
      await reorderDocuments(
        siblings.map((d, index) => ({id: d.id, order: index})),
        tx
      );
      return updateDocumentModel(documentId, {...data, parentId: nextParentId}, tx);
    });
  }

  return updateDocumentModel(documentId, data);
}

export async function deleteDocument(wikiId: string, documentId: string): Promise<void> {
  await getDocument(wikiId, documentId);
  await deleteDocumentModel(documentId);
}

/** 供搜索接口使用：`wikiIds` 必须是调用方已确认当前用户可访问的范围，这里不重复做权限判断 */
export function searchDocuments(wikiIds: string[], keyword: string): Promise<Document[]> {
  return searchDocumentsModel(wikiIds, keyword);
}

export function listVersions(documentId: string): Promise<DocumentVersion[]> {
  return documentVersionService.listVersions(documentId);
}

/**
 * 恢复到某个历史版本：把该版本内容写回当前文档，并把这次恢复本身当成一次新的编辑
 * （复用 `updateDocument` 的版本快照逻辑），不删除恢复目标之后的任何历史版本
 * （见 document-versioning spec.md「恢复操作不删除历史，追加新记录」）。
 */
export async function restoreVersion(
  wikiId: string,
  documentId: string,
  versionId: string,
  userId: string
): Promise<Document> {
  await getDocument(wikiId, documentId);
  const version = await documentVersionService.findVersionForRestore(documentId, versionId);
  return updateDocument(
    wikiId,
    documentId,
    {title: version.title, content: version.content},
    userId
  );
}
