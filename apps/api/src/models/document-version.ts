import {prisma} from '../db/prisma';
import type {DocumentVersion, Prisma, PrismaClient} from '../generated/prisma/client';

export type {DocumentVersion};

/** 允许调用方传入事务客户端（tx），保证跨多次查询/写入的原子性；不传时默认走全局单例 */
type Client = PrismaClient | Prisma.TransactionClient;

export interface CreateVersionInput {
  documentId: string;
  title: string;
  content: Prisma.InputJsonValue;
  createdBy: string;
}

export function createVersion(
  input: CreateVersionInput,
  client: Client = prisma
): Promise<DocumentVersion> {
  return client.documentVersion.create({data: input});
}

export interface UpdateVersionContentInput {
  title: string;
  content: Prisma.InputJsonValue;
}

/**
 * 更新"当前编辑会话对应的最近一条版本记录"的快照内容，并把该记录的 `updatedAt` 顺带
 * 刷新到当前时间（`@updatedAt` 自动完成）——下一次保存判断"是否超过会话阈值"时，比较的
 * 就是这个刷新后的时间，而不是这条记录固定不变的 `createdAt`（见 prisma/models/document.prisma 注释）。
 */
export function updateLatestVersionContent(
  versionId: string,
  data: UpdateVersionContentInput,
  client: Client = prisma
): Promise<DocumentVersion> {
  return client.documentVersion.update({where: {id: versionId}, data});
}

export function findLatestVersion(
  documentId: string,
  client: Client = prisma
): Promise<DocumentVersion | null> {
  return client.documentVersion.findFirst({
    where: {documentId},
    orderBy: {updatedAt: 'desc'}
  });
}

export function listVersionsByDocumentId(
  documentId: string,
  client: Client = prisma
): Promise<DocumentVersion[]> {
  return client.documentVersion.findMany({
    where: {documentId},
    orderBy: {updatedAt: 'desc'}
  });
}

export function findVersionById(
  id: string,
  client: Client = prisma
): Promise<DocumentVersion | null> {
  return client.documentVersion.findUnique({where: {id}});
}
