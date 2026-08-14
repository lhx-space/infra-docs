import {prisma} from '../db/prisma';
import {Prisma, type TeamInvite} from '../generated/prisma/client';
import {findTeamById} from '../models/team';
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
 *
 * 个人 Team 禁止生成邀请链接——路由层 `requireTeamRole('OWNER')` 只校验"是不是这个 Team
 * 的 OWNER"，个人 Team 的唯一成员本身就是 OWNER，天然会通过这层校验，所以必须在这里单独
 * 拦一次，否则任何人都能把自己的"个人空间"变成一个可以拉别人进来的多人团队——这跟"个人
 * Team 只在注册流程创建、只有唯一成员"这个不变量（见 team-workspace spec.md）直接冲突，
 * 而且一旦有人真的借此加入了别人的个人 Team，会撞上另一个更严重的后果：
 * `removeTeamMember`/退出团队的校验只看 `team.isPersonal`（不区分是不是真的所有者），
 * 那个被误拉进来的成员将永久无法退出这个 Team。
 */
export async function createInvite(
  teamId: string,
  createdBy: string,
  input: CreateInviteInput
): Promise<TeamInvite> {
  const team = await findTeamById(teamId);
  if (!team) {
    throw new TeamInviteError(404, 'not_found');
  }
  if (team.isPersonal) {
    throw new TeamInviteError(403, 'cannot_invite_personal_team');
  }

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
 *
 * 这里再查一次 `team.isPersonal` 是有意的第二层防护，不是多余的重复判断：`createInvite`
 * 已经在源头拦住了"给个人 Team 生成邀请链接"，但兑换这一步面对的是**已经存在**的
 * `TeamInvite` 记录，没法保证它一定是经过修复后的 `createInvite` 生成的（比如修复上线前
 * 就已经生成、还没过期的旧链接）——两处检查各自堵住这个不变量在不同时间点可能被绕过的
 * 路径，跟本仓库其它地方"多层防护，各管各的失效模式"的思路一致。
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

    const team = await findTeamById(invite.teamId, tx);
    if (!team) {
      throw new TeamInviteError(404, 'not_found');
    }
    if (team.isPersonal) {
      throw new TeamInviteError(403, 'cannot_join_personal_team');
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
