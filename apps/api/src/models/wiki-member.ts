import {prisma} from '../db/prisma';
import type {Prisma, PrismaClient, WikiMember, WikiRole} from '../generated/prisma/client';

export type {WikiMember, WikiRole};

/** 允许调用方传入事务客户端（tx），保证跨多次查询/写入的原子性；不传时默认走全局单例 */
type Client = PrismaClient | Prisma.TransactionClient;

/** 成员列表展示需要用户名（见 wiki-workspace-console spec.md「工作区以 Card 形式展示」附带的 Members 需求），
 * 用 Prisma 关联查询把 User.username 一起带出来，不需要额外接口。 */
export interface WikiMemberWithUser extends WikiMember {
  user: {id: string; username: string};
}

export function createWikiMember(
  wikiId: string,
  userId: string,
  role: WikiRole
): Promise<WikiMember> {
  return prisma.wikiMember.create({data: {wikiId, userId, role}});
}

export function findWikiMember(
  wikiId: string,
  userId: string,
  client: Client = prisma
): Promise<WikiMember | null> {
  return client.wikiMember.findUnique({where: {wikiId_userId: {wikiId, userId}}});
}

export function listWikiMembers(wikiId: string): Promise<WikiMemberWithUser[]> {
  return prisma.wikiMember.findMany({
    where: {wikiId},
    orderBy: {createdAt: 'asc'},
    include: {user: {select: {id: true, username: true}}}
  });
}

/** 用于"最后一个 OWNER"保护判断（design.md 决策 4），只统计角色为 OWNER 的成员数量 */
export function countOwners(wikiId: string, client: Client = prisma): Promise<number> {
  return client.wikiMember.count({where: {wikiId, role: 'OWNER'}});
}

/**
 * 找一个仍持有 OWNER 角色、且不是 excludeUserId 的成员（按加入时间最早排序），
 * 用于 ownerId 需要重新指向别人时选一个"现任 OWNER"（见 wiki-workspace-fixes design.md 决策 3）。
 */
export function findAnyOtherOwner(
  wikiId: string,
  excludeUserId: string,
  client: Client = prisma
): Promise<WikiMember | null> {
  return client.wikiMember.findFirst({
    where: {wikiId, role: 'OWNER', userId: {not: excludeUserId}},
    orderBy: {createdAt: 'asc'}
  });
}

export function updateWikiMemberRole(
  wikiId: string,
  userId: string,
  role: WikiRole,
  client: Client = prisma
): Promise<WikiMember> {
  return client.wikiMember.update({
    where: {wikiId_userId: {wikiId, userId}},
    data: {role}
  });
}

export function deleteWikiMember(
  wikiId: string,
  userId: string,
  client: Client = prisma
): Promise<WikiMember> {
  return client.wikiMember.delete({where: {wikiId_userId: {wikiId, userId}}});
}
