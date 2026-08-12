import {prisma} from '../db/prisma';
import {Prisma, type WikiJoinRequest, type WikiRole} from '../generated/prisma/client';
import {findTeamMember} from '../models/team-member';
import {findWikiById} from '../models/wiki';
import {
  findJoinRequest,
  findJoinRequestById,
  listPendingJoinRequests as listPendingJoinRequestsModel,
  updateJoinRequestStatusIfPending,
  upsertJoinRequest,
  type WikiJoinRequestWithUser
} from '../models/wiki-join-request';
import {createWikiMember, findWikiMember} from '../models/wiki-member';

/** 风格对齐 services/wiki.ts 的 WikiError：status + message，handler 层统一映射成 HTTP 状态码 */
export class WikiJoinRequestError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'WikiJoinRequestError';
    this.status = status;
  }
}

/** 被拒绝后的冷却时间，默认 24 小时（见 design.md Open Questions，先取这个默认值） */
const COOLDOWN_MS = 24 * 60 * 60 * 1000;

/**
 * 发起申请：校验 `allowJoinRequest` 已开启、申请人是同 Team 成员、尚非该 Wiki 成员、
 * 不在冷却期内（见 team-workspace-model spec.md「申请加入工作区」）。
 */
export async function createJoinRequest(wikiId: string, userId: string): Promise<WikiJoinRequest> {
  const wiki = await findWikiById(wikiId);
  if (!wiki) throw new WikiJoinRequestError(404, 'not_found');
  if (!wiki.allowJoinRequest) throw new WikiJoinRequestError(403, 'join_request_disabled');

  const teamMembership = await findTeamMember(wiki.teamId, userId);
  if (!teamMembership) throw new WikiJoinRequestError(403, 'not_team_member');

  const existingMember = await findWikiMember(wikiId, userId);
  if (existingMember) throw new WikiJoinRequestError(409, 'already_member');

  const existingRequest = await findJoinRequest(wikiId, userId);
  if (existingRequest?.status === 'PENDING') {
    return existingRequest; // 幂等：已有待处理申请，不重复创建
  }
  if (existingRequest?.status === 'REJECTED' && existingRequest.reviewedAt) {
    const elapsed = Date.now() - existingRequest.reviewedAt.getTime();
    if (elapsed < COOLDOWN_MS) {
      throw new WikiJoinRequestError(429, 'too_many_requests');
    }
  }

  return upsertJoinRequest(wikiId, userId);
}

/** 供 OWNER 视角展示待审批列表，权限已由 requireWikiRole('OWNER') 中间件前置校验 */
export function listPendingJoinRequests(wikiId: string): Promise<WikiJoinRequestWithUser[]> {
  return listPendingJoinRequestsModel(wikiId);
}

export interface ReviewDecision {
  approve: boolean;
  /** 批准时授予的角色，未指定默认 VIEWER */
  role?: WikiRole;
}

/**
 * 审批：条件更新（`WHERE status = 'PENDING'`）保证两个 OWNER 几乎同时处理同一条申请时，
 * 只有先完成的一个生效，后完成的因为影响行数为 0 而收到冲突提示（见 design.md 决策 9）。
 */
export async function reviewJoinRequest(
  requestId: string,
  wikiId: string,
  reviewerId: string,
  decision: ReviewDecision
): Promise<void> {
  const request = await findJoinRequestById(requestId);
  if (!request || request.wikiId !== wikiId) {
    throw new WikiJoinRequestError(404, 'not_found');
  }

  await prisma.$transaction(async tx => {
    const affected = await updateJoinRequestStatusIfPending(
      requestId,
      decision.approve ? 'APPROVED' : 'REJECTED',
      reviewerId,
      tx
    );
    if (affected === 0) {
      throw new WikiJoinRequestError(409, 'already_reviewed');
    }

    if (decision.approve) {
      try {
        await createWikiMember(wikiId, request.userId, decision.role ?? 'VIEWER', tx);
      } catch (err) {
        // 申请人在审批完成前已通过别的路径（如被 OWNER 直接添加）成为成员，视为幂等成功
        if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) {
          throw err;
        }
      }
    }
  });
}
