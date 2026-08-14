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
import {countImageAssetOccurrences, diffImageAssetOccurrences} from '../utils/image-content';
import {countVideoAssetOccurrences, diffVideoAssetOccurrences} from '../utils/video-content';
import * as documentVersionService from './document-version';
import {acquireImageRef, releaseImageRef} from './storage';
import {acquireVideoRef, releaseVideoRef} from './video';
import {contentJsonToYjsState, yjsStateToContentJson} from './yjs-content';

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

  // 一旦文档完成协同初始化（yjsState 非空），正文内容只能通过实时协同连接更新，旧的
  // REST 整篇覆盖写路径必须拒绝，避免两条写路径并存导致覆盖/丢失（见
  // yjs-realtime-collaboration design.md 决策 9、specs/realtime-collaboration「已启用
  // 协同的文档拒绝旧的整篇覆盖写入」）。标题不受此限制，继续走这里。
  if (input.content !== undefined && existing.yjsState !== null) {
    throw new DocumentError(409, 'collaboration_enabled');
  }

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
  const result =
    parentChanged || input.order !== undefined
      ? await prisma.$transaction(async tx => {
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
        })
      : await updateDocumentModel(documentId, data);

  // coverImage 变更（替换或清空）时释放旧引用（见 image-upload-dedup design.md 决策 4），
  // 必须等上面的更新真正成功之后才释放，避免更新失败时旧图片的引用被错误地提前减掉。
  if (
    input.coverImage !== undefined &&
    input.coverImage !== existing.coverImage &&
    existing.coverImage
  ) {
    await releaseImageRef(existing.coverImage);
  }

  // 正文变化时同步维护视频引用计数（见 video-dedup-and-lifecycle design.md 决策 2、
  // spec.md「视频引用计数生命周期管理」）：按 assetId 对比更新前后内容里的出现次数，
  // 次数减少的释放对应差值、次数增加的（如恢复到一个更早引用了某视频的历史版本）补上
  // 对应差值。同样必须等上面的更新真正成功之后才执行。
  if (input.content !== undefined) {
    const {acquired, released} = diffVideoAssetOccurrences(existing.content, input.content);
    for (const [assetId, times] of acquired) await acquireVideoRef(assetId, times);
    for (const [assetId, times] of released) await releaseVideoRef(assetId, times);

    // 正文图片同理（见 upload-reliability-hardening design.md 决策 5、spec.md「正文
    // 图片引用生命周期管理」）：跟上面视频的写法完全对称，两条路径分别按各自的节点
    // 类型统计，互不干扰；跟下面 `coverImage` 单字段比较也是两条独立路径（一个是
    // 字符串字段直接比较，一个是 JSON 内容树递归统计），不会对同一次引用重复计数。
    const imageDiff = diffImageAssetOccurrences(existing.content, input.content);
    for (const [src, times] of imageDiff.acquired) await acquireImageRef(src, times);
    for (const [src, times] of imageDiff.released) await releaseImageRef(src, times);
  }

  return result;
}

export async function deleteDocument(wikiId: string, documentId: string): Promise<void> {
  const existing = await getDocument(wikiId, documentId);
  await deleteDocumentModel(documentId);
  // 见 image-upload-dedup design.md 决策 4：删除文档后释放其封面图的一次引用
  if (existing.coverImage) {
    await releaseImageRef(existing.coverImage);
  }
  // 见 video-dedup-and-lifecycle spec.md「删除文档释放全部视频引用」：按文档内容中
  // 每个视频资产的出现次数，逐个释放对应次数的引用
  for (const [assetId, times] of countVideoAssetOccurrences(existing.content)) {
    await releaseVideoRef(assetId, times);
  }
  // 见 upload-reliability-hardening spec.md「删除文档释放全部正文图片引用」：跟视频
  // 是同一套写法，独立于上面的 `coverImage` 释放
  for (const [src, times] of countImageAssetOccurrences(existing.content)) {
    await releaseImageRef(src, times);
  }
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

/**
 * 供 gRPC `DocumentSyncService.GetDocumentContent` 使用（见 yjs-realtime-collaboration
 * design.md 决策 6）：`apps/collab-server` 在存量文档首次被协同打开、`yjsState` 仍为空时，
 * 调用这个方法取回"由当前 `content` 转换出的初始 Yjs 二进制状态"——转换本身（ProseMirror
 * JSON → Yjs）在这里用 `y-prosemirror` 完成（见决策 5 的实现阶段修正说明），
 * `collab-server` 拿到后直接反序列化使用，不需要理解 ProseMirror 的具体结构。不做任何
 * 权限校验——调用这个方法之前，`collab-server` 已经在连接建立阶段通过 `CheckDocumentRole`
 * 校验过权限（见决策 4），这里只是内部服务间调用，不重复校验。
 */
export async function getDocumentContentForCollab(documentId: string): Promise<Buffer> {
  const doc = await findDocumentById(documentId);
  if (!doc) {
    throw new DocumentError(404, 'not_found');
  }
  return contentJsonToYjsState(doc.content);
}

/**
 * 供 gRPC `DocumentSyncService.SyncDocumentContent` 使用（见 design.md 决策 5/7）：
 * `collab-server` 周期性持久化时传来某一时刻完整的 Yjs 状态，这里先用 `y-prosemirror`
 * 还原出对应的 ProseMirror JSON（见决策 5 的实现阶段修正说明），再同步 `content`/
 * `searchText`，并在内容确实变化时按既有"编辑会话聚合"规则追加/更新一条版本快照
 * （复用 `snapshotVersion`，不重新实现，见 document-versioning spec.md）。
 *
 * `lastEditorId` 为空字符串（房间从未记录到任何写入方，理论上不应发生）时只同步
 * `content`/`searchText`，跳过版本快照——`DocumentVersion.createdBy` 是必填字段，
 * 没有明确作者的情况下不应该新建一条版本记录。
 *
 * 内容是否变化的判断用字符串比较（两侧都来自同一套 JSON 序列化路径，结构化 deep-equal
 * 在这里没有必要引入额外依赖）；调用方（`collab-server`）不需要自己维护"上一次内容是
 * 什么"的状态，这条判断只在这里做一次。
 */
export async function syncContentFromCollab(
  documentId: string,
  yjsState: Uint8Array,
  lastEditorId: string
): Promise<{contentChanged: boolean}> {
  const existing = await findDocumentById(documentId);
  if (!existing) {
    throw new DocumentError(404, 'not_found');
  }

  const parsedContent = yjsStateToContentJson(yjsState) as Prisma.InputJsonValue;
  const contentChanged = JSON.stringify(existing.content) !== JSON.stringify(parsedContent);
  if (!contentChanged) {
    return {contentChanged: false};
  }

  const searchText = extractPlainText(parsedContent);
  await updateDocumentModel(documentId, {content: parsedContent, searchText});

  if (lastEditorId) {
    await documentVersionService.snapshotVersion(
      documentId,
      existing.title,
      parsedContent,
      lastEditorId
    );
  }

  return {contentChanged: true};
}
