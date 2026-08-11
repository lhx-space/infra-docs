import {prisma} from '../db/prisma';
import type {Prisma, PrismaClient, Wiki} from '../generated/prisma/client';

export type {Wiki};

/** 允许调用方传入事务客户端（tx），保证跨多次查询/写入的原子性；不传时默认走全局单例 */
type Client = PrismaClient | Prisma.TransactionClient;

export function findWikiById(id: string, client: Client = prisma): Promise<Wiki | null> {
  return client.wiki.findUnique({where: {id}});
}

/** 通过 WikiMember 反查当前用户所在的所有工作区，按工作区更新时间倒序（见 design.md 决策 3） */
export function listWikisByUserId(userId: string): Promise<Wiki[]> {
  return prisma.wiki.findMany({
    where: {members: {some: {userId}}},
    orderBy: {updatedAt: 'desc'}
  });
}

export interface UpdateWikiInfoInput {
  name?: string;
  description?: string;
  coverImage?: string;
}

export function updateWikiInfo(id: string, data: UpdateWikiInfoInput): Promise<Wiki> {
  return prisma.wiki.update({where: {id}, data});
}

/**
 * 单独更新 ownerId：成员角色变更/移除导致 ownerId 当前指向的用户不再是 OWNER 时，
 * 由 services/wiki.ts 的 syncWikiOwnerIfNeeded 在同一事务内调用（见
 * wiki-workspace-fixes design.md 决策 3、spec.md「工作区拥有者引用与实际 OWNER 保持一致」）。
 */
export function updateWikiOwner(
  id: string,
  ownerId: string,
  client: Client = prisma
): Promise<Wiki> {
  return client.wiki.update({where: {id}, data: {ownerId}});
}

/** WikiMember 记录通过 schema 的 onDelete: Cascade 自动级联删除，不需要在这里手动清理 */
export function deleteWiki(id: string): Promise<Wiki> {
  return prisma.wiki.delete({where: {id}});
}
