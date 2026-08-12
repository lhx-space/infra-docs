import {prisma} from '../db/prisma';
import type {Prisma, PrismaClient, TeamInviteRedemption} from '../generated/prisma/client';

export type {TeamInviteRedemption};

/** 允许调用方传入事务客户端（tx），保证跨多次查询/写入的原子性；不传时默认走全局单例 */
type Client = PrismaClient | Prisma.TransactionClient;

export function createRedemption(
  inviteId: string,
  userId: string,
  client: Client = prisma
): Promise<TeamInviteRedemption> {
  return client.teamInviteRedemption.create({data: {inviteId, userId}});
}

/** 统计一条邀请链接已经被使用（成功创建过新成员）的次数，用于 maxUses 上限判断 */
export function countRedemptions(inviteId: string, client: Client = prisma): Promise<number> {
  return client.teamInviteRedemption.count({where: {inviteId}});
}
