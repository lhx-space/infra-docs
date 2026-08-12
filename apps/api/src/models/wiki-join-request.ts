import {prisma} from '../db/prisma';
import type {
  JoinRequestStatus,
  Prisma,
  PrismaClient,
  WikiJoinRequest
} from '../generated/prisma/client';

export type {WikiJoinRequest};

/** 允许调用方传入事务客户端（tx），保证跨多次查询/写入的原子性；不传时默认走全局单例 */
type Client = PrismaClient | Prisma.TransactionClient;

export function findJoinRequest(
  wikiId: string,
  userId: string,
  client: Client = prisma
): Promise<WikiJoinRequest | null> {
  return client.wikiJoinRequest.findUnique({where: {wikiId_userId: {wikiId, userId}}});
}

export function findJoinRequestById(
  id: string,
  client: Client = prisma
): Promise<WikiJoinRequest | null> {
  return client.wikiJoinRequest.findUnique({where: {id}});
}

export interface WikiJoinRequestWithUser extends WikiJoinRequest {
  user: {id: string; username: string};
}

/** 供 OWNER 视角的"待审批申请"列表使用，带出申请人用户名（不需要额外一次 lookup） */
export function listPendingJoinRequests(wikiId: string): Promise<WikiJoinRequestWithUser[]> {
  return prisma.wikiJoinRequest.findMany({
    where: {wikiId, status: 'PENDING'},
    orderBy: {createdAt: 'asc'},
    include: {user: {select: {id: true, username: true}}}
  });
}

/**
 * 每个用户对每个 Wiki 只保留一条记录（`@@unique([wikiId, userId])`），被拒绝后再申请
 * 是更新同一行的 status，不追加历史行——upsert 天然满足这个语义（见 design.md 决策 9）。
 */
export function upsertJoinRequest(
  wikiId: string,
  userId: string,
  client: Client = prisma
): Promise<WikiJoinRequest> {
  return client.wikiJoinRequest.upsert({
    where: {wikiId_userId: {wikiId, userId}},
    create: {wikiId, userId, status: 'PENDING'},
    update: {status: 'PENDING', reviewedBy: null, reviewedAt: null}
  });
}

/**
 * 条件更新：只有当前状态仍是 PENDING 时才允许变更为 APPROVED/REJECTED，返回受影响行数；
 * 影响行数为 0 说明已经被别的请求处理过，调用方据此判断"两个 OWNER 并发审批"的冲突
 * （见 design.md 决策 9、spec.md「审批加入申请」）。
 */
export async function updateJoinRequestStatusIfPending(
  id: string,
  status: Exclude<JoinRequestStatus, 'PENDING'>,
  reviewedBy: string,
  client: Client = prisma
): Promise<number> {
  const result = await client.wikiJoinRequest.updateMany({
    where: {id, status: 'PENDING'},
    data: {status, reviewedBy, reviewedAt: new Date()}
  });
  return result.count;
}
