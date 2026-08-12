import type {DocumentVersion, Prisma} from '../generated/prisma/client';
import {
  createVersion,
  findLatestVersion,
  findVersionById,
  listVersionsByDocumentId,
  updateLatestVersionContent
} from '../models/document-version';

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
