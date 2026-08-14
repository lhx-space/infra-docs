import type {DocumentVersion, Prisma} from '../generated/prisma/client';
import {listContributorUserIds} from '../models/document-contributor';
import {
  createVersion,
  findLatestVersion,
  findVersionById,
  listDistinctEditorIds,
  listVersionsByDocumentId,
  updateLatestVersionContent
} from '../models/document-version';
import {findUsersWithProfileByIds} from '../models/user';

export interface DocumentEditor {
  id: string;
  username: string;
  avatarUrl: string | null;
}

export class DocumentVersionError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'DocumentVersionError';
    this.status = status;
  }
}

/** 编辑会话中断判定阈值：超过这个时长才切一个新版本，否则更新当前会话对应的最近一条记录
 * （见 design.md 决策「版本切分阈值：连续编辑中断超过 30 分钟算一个新版本」）。 */
const SESSION_GAP_THRESHOLD_MS = 30 * 60 * 1000;

/**
 * 保存内容后按"编辑会话聚合"规则写入一条版本记录：距最近一条版本记录的 `updatedAt`
 * 超过阈值则新建，否则更新那一条记录的快照内容，不逐次保存都新增版本
 * （见 document-versioning spec.md「版本按编辑会话聚合触发」）。
 */
export async function snapshotVersion(
  documentId: string,
  title: string,
  content: Prisma.InputJsonValue,
  createdBy: string
): Promise<DocumentVersion> {
  const latest = await findLatestVersion(documentId);
  const withinSession =
    latest !== null && Date.now() - latest.updatedAt.getTime() < SESSION_GAP_THRESHOLD_MS;

  if (latest && withinSession) {
    return updateLatestVersionContent(latest.id, {title, content});
  }
  return createVersion({documentId, title, content, createdBy});
}

export function listVersions(documentId: string): Promise<DocumentVersion[]> {
  return listVersionsByDocumentId(documentId);
}

/**
 * 历史编辑人列表（见 packages/tiptap-editor 「标题旁展示历史编辑人」的体验优化）：
 * 合并两个来源的作者 id 后去重，再批量补上 username/avatarUrl：
 *
 * - `listDistinctEditorIds`（`DocumentVersion.createdBy` 去重）：兼容本次修复上线前
 *   就已经存在的历史版本记录——那些记录只留下了"触发快照那一刻的最后写入方"，做不到
 *   完整的编辑者归因，但仍然是真实编辑过的人，不能因为改了写入逻辑就丢弃这部分数据。
 * - `listContributorUserIds`（`DocumentContributor` 表）：本次修复新增的、跟版本快照
 *   完全解耦的编辑者记录，每次内容确实发生变化就会 upsert，不受版本"编辑会话聚合"
 *   规则的影响，是这个列表准确性的主要来源（见 services/document.ts
 *   `syncContentFromCollab` 顶部注释——那里详细解释了为什么只靠 `DocumentVersion`
 *   会导致同一协同会话内的其他编辑者从这个列表里消失）。
 */
export async function listEditors(documentId: string): Promise<DocumentEditor[]> {
  const [versionEditorIds, contributorIds] = await Promise.all([
    listDistinctEditorIds(documentId),
    listContributorUserIds(documentId)
  ]);
  const editorIds = Array.from(new Set([...versionEditorIds, ...contributorIds]));
  if (editorIds.length === 0) return [];

  const users = await findUsersWithProfileByIds(editorIds);
  return users.map(user => ({
    id: user.id,
    username: user.username,
    avatarUrl: user.profile?.avatarUrl ?? null
  }));
}

/** 恢复前的合法性校验：版本必须真实存在且归属该文档，不允许跨文档恢复 */
export async function findVersionForRestore(
  documentId: string,
  versionId: string
): Promise<DocumentVersion> {
  const version = await findVersionById(versionId);
  if (!version || version.documentId !== documentId) {
    throw new DocumentVersionError(404, 'not_found');
  }
  return version;
}
