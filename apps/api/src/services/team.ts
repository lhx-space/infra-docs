import {prisma} from '../db/prisma';
import type {Prisma, Team, TeamMember, TeamRole} from '../generated/prisma/client';
import {
  createTeam as createTeamModel,
  deleteTeam as deleteTeamModel,
  findTeamById,
  listTeamsByUserId,
  updateTeamName
} from '../models/team';
import {
  countOwners,
  createTeamMember,
  deleteTeamMember,
  findAnyOtherOwner,
  findTeamMember,
  listTeamMembers as listTeamMembersModel,
  type TeamMemberWithUser,
  updateTeamMemberRole as updateTeamMemberRoleModel
} from '../models/team-member';
import {listWikiDirectoryByTeam, type WikiTeamDirectoryEntry} from '../models/wiki';
import {
  countOwners as countWikiOwners,
  deleteWikiMembershipsInTeam,
  listWikiMembershipsInTeam
} from '../models/wiki-member';
import {transferSoleWikiOwnership} from './wiki';

/** 风格对齐 services/wiki.ts 的 WikiError：status + message，handler 层统一映射成 HTTP 状态码 */
export class TeamError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'TeamError';
    this.status = status;
  }
}

/**
 * 创建团队：用事务原子性地同时创建 Team + role: OWNER 的 TeamMember 记录（跟
 * services/wiki.ts 的 createWiki 是同一个模式）。`isPersonal` 固定为 false——
 * 个人 Team 只在注册流程（services/auth.ts）里创建，这里只处理用户主动创建的多人 Team。
 */
export async function createTeam(userId: string, name: string): Promise<Team> {
  return prisma.$transaction(async tx => {
    const team = await createTeamModel(name, false, tx);
    await createTeamMember(team.id, userId, 'OWNER', tx);
    return team;
  });
}

export function listMyTeams(userId: string): Promise<Team[]> {
  return listTeamsByUserId(userId);
}

export function getTeam(teamId: string): Promise<Team | null> {
  return findTeamById(teamId);
}

/** 个人 Team 也允许改名（改的只是显示名称，不影响其"个人 Team"身份） */
export function updateTeam(teamId: string, name: string): Promise<Team> {
  return updateTeamName(teamId, name);
}

export function listTeamMembers(teamId: string): Promise<TeamMemberWithUser[]> {
  return listTeamMembersModel(teamId);
}

/**
 * 团队工作区目录：只返回元信息（名称/简介/封面/是否开放申请/我是否已是成员），
 * 不包含文档内容或成员名单——权限校验（是否为该 Team 成员）由 requireTeamRole 中间件
 * 前置完成，这里直接查（见 team-workspace-model spec.md「团队成员可浏览团队内工作区目录」）。
 */
export function listTeamWikis(teamId: string, userId: string): Promise<WikiTeamDirectoryEntry[]> {
  return listWikiDirectoryByTeam(teamId, userId);
}

/**
 * 变更/移除前先检查"最后一个 OWNER"边界，跟 services/wiki.ts 的 assertNotRemovingLastOwner
 * 是完全一样的模式：查询和后续写入共享同一个事务客户端（tx），把竟态窗口收窄到事务内部
 * （见 design.md 决策 6：Team 唯一 OWNER 保护直接复用 Wiki 层已验证的实现）。
 */
async function assertNotRemovingLastTeamOwner(
  tx: Prisma.TransactionClient,
  teamId: string,
  targetUserId: string,
  nextRoleIfDemoting: TeamRole | null
): Promise<void> {
  const target = await findTeamMember(teamId, targetUserId, tx);
  if (target?.role !== 'OWNER') return;
  if (nextRoleIfDemoting === 'OWNER') return;

  const ownerCount = await countOwners(teamId, tx);
  if (ownerCount <= 1) {
    throw new TeamError(409, 'last_owner_required');
  }
}

export async function updateTeamMemberRole(
  teamId: string,
  targetUserId: string,
  role: TeamRole
): Promise<TeamMember> {
  return prisma.$transaction(async tx => {
    await assertNotRemovingLastTeamOwner(tx, teamId, targetUserId, role);
    return updateTeamMemberRoleModel(teamId, targetUserId, role, tx);
  });
}

/**
 * 成员退出（或被移除出）团队：在同一事务内，
 * 1) 找出该用户在该 Team 下所有 Wiki 的成员记录
 * 2) 对其中该用户是唯一显式 OWNER 的 Wiki，把 OWNER 转移给当前 Team 中最早加入且仍是
 *    OWNER 的成员（见 services/wiki.ts 的 transferSoleWikiOwnership）
 * 3) 批量清理该用户在这些 Wiki 下的原有成员记录
 * 4) 删除 TeamMember 记录本身
 * （见 team-workspace-model design.md 决策 7、spec.md「退出团队时的工作区所有权转移」）
 */
export async function removeTeamMember(teamId: string, targetUserId: string): Promise<TeamMember> {
  return prisma.$transaction(async tx => {
    const team = await findTeamById(teamId, tx);
    if (!team) throw new TeamError(404, 'not_found');
    if (team.isPersonal) throw new TeamError(403, 'cannot_leave_personal_team');

    await assertNotRemovingLastTeamOwner(tx, teamId, targetUserId, null);

    const memberships = await listWikiMembershipsInTeam(teamId, targetUserId, tx);
    for (const membership of memberships) {
      if (membership.role !== 'OWNER') continue;

      const ownerCount = await countWikiOwners(membership.wikiId, tx);
      if (ownerCount > 1) continue; // 不是唯一 OWNER，不需要转移

      // 找当前 Team 中最早加入且仍是 OWNER 的成员作为接收方；理论上一定存在
      // （上面已经保证 Team 至少还剩一个 OWNER），找不到属于防御性分支，跳过不阻塞整体流程
      const receiver = await findAnyOtherOwner(teamId, targetUserId, tx);
      if (!receiver) continue;

      await transferSoleWikiOwnership(tx, membership.wikiId, receiver.userId);
    }

    await deleteWikiMembershipsInTeam(teamId, targetUserId, tx);
    return deleteTeamMember(teamId, targetUserId, tx);
  });
}

/** 非个人 Team 才允许删除，仅 OWNER 可调用（路由层已用 requireTeamRole('OWNER') 校验） */
export async function deleteTeam(teamId: string): Promise<Team> {
  return prisma.$transaction(async tx => {
    const team = await findTeamById(teamId, tx);
    if (!team) throw new TeamError(404, 'not_found');
    if (team.isPersonal) throw new TeamError(403, 'cannot_delete_personal_team');
    return deleteTeamModel(teamId, tx);
  });
}
