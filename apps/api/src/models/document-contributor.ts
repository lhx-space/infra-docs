import {prisma} from '../db/prisma';
import type {DocumentContributor, Prisma, PrismaClient} from '../generated/prisma/client';

export type {DocumentContributor};

/** 允许调用方传入事务客户端（tx），保证跨多次查询/写入的原子性；不传时默认走全局单例 */
type Client = PrismaClient | Prisma.TransactionClient;

/**
 * 记录"这个人对这篇文档做过至少一次实际生效的编辑"，跟 `DocumentVersion` 的版本快照
 * 完全独立（见 prisma/models/document.prisma 上方注释）——不依赖 `@updatedAt` 自动
 * 刷新（空的 `update: {}` 不会触发它），显式传入当前时间，语义更明确。
 */
export function upsertDocumentContributor(
  documentId: string,
  userId: string,
  client: Client = prisma
): Promise<DocumentContributor> {
  const now = new Date();
  return client.documentContributor.upsert({
    where: {documentId_userId: {documentId, userId}},
    create: {documentId, userId, firstEditedAt: now, lastEditedAt: now},
    update: {lastEditedAt: now}
  });
}

/** 历史编辑人列表用（见 services/document-version.ts 的 `listEditors`）：量级是"这篇
 * 文档曾经贡献过编辑的人数"，不会很大，不需要分页/排序。 */
export async function listContributorUserIds(
  documentId: string,
  client: Client = prisma
): Promise<string[]> {
  const rows = await client.documentContributor.findMany({
    where: {documentId},
    select: {userId: true}
  });
  return rows.map(row => row.userId);
}
