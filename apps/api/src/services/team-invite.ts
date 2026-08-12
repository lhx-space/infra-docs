import {prisma} from '../db/prisma';
import {Prisma, type TeamInvite} from '../generated/prisma/client';
import {
  createTeamInvite as createTeamInviteModel,
  findTeamInviteById,
  findTeamInviteByToken,
  revokeTeamInvite as revokeTeamInviteModel
} from '../models/team-invite';
import {countRedemptions, createRedemption} from '../models/team-invite-redemption';
import {createTeamMember, findTeamMember} from '../models/team-member';
import {generateToken} from '../utils/random-token';

/** 风格对齐 services/team.ts 的 TeamError：status + message，handler 层统一映射成 HTTP 状态码 */
export class TeamInviteError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'TeamInviteError';
    this.status = status;
  }
}

export interface CreateInviteInput {
  maxUses?: number;
  expiresAt?: Date;
}

/**
 * 生成邀请链接：角色固定 MEMBER（服务层强制，不接受 OWNER），不需要事务
 * （单条 insert，见 team-workspace-model design.md 决策 5）。
 */
export function createInvite(
  teamId: string,
  createdBy: string,
  input: CreateInviteInput
): Promise<TeamInvite> {
  return createTeamInviteModel({
    teamId,
    token: generateToken(),
    role: 'MEMBER',
    maxUses: input.maxUses,
    expiresAt: input.expiresAt,
    createdBy
  });
}

export async function revokeInvite(inviteId: string, teamId: string): Promise<void> {
  const invite = await findTeamInviteById(inviteId);
  if (!invite || invite.teamId !== teamId) {
    throw new TeamInviteError(404, 'not_found');
  }
  await revokeTeamInviteModel(inviteId);
}

/**
 * 兑换邀请链接：已经是成员时直接幂等返回成功，不计入使用次数、不重复创建记录；
 * 校验过期/失效/次数上限；"创建成员"这步遇到并发下的唯一约束冲突（P2002）时视为
 * 幂等成功（另一个并发请求已经创建成功），不抛错——跟 services/wiki.ts 的
 * addWikiMember 是同一个思路（见 design.md 决策 5）。
 */
export async function redeemInvite(token: string, userId: string): Promise<{teamId: string}> {
  return prisma.$transaction(async tx => {
    const invite = await findTeamInviteByToken(token, tx);
    if (!invite) {
      throw new TeamInviteError(404, 'not_found');
    }
    if (invite.revokedAt || (invite.expiresAt && invite.expiresAt <= new Date())) {
      throw new TeamInviteError(410, 'invite_expired');
    }

    const existingMember = await findTeamMember(invite.teamId, userId, tx);
    if (existingMember) {
      return {teamId: invite.teamId}; // 幂等：已经是成员，不消耗使用次数
    }

    if (invite.maxUses !== null) {
      const used = await countRedemptions(invite.id, tx);
      if (used >= invite.maxUses) {
        throw new TeamInviteError(410, 'invite_exhausted');
      }
    }

    try {
      await createTeamMember(invite.teamId, userId, invite.role, tx);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return {teamId: invite.teamId}; // 并发下另一个请求已经创建成功，视为幂等成功
      }
      throw err;
    }
    await createRedemption(invite.id, userId, tx);
    return {teamId: invite.teamId};
  });
}
