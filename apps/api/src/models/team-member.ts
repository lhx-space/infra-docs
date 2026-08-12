import {prisma} from '../db/prisma';
import type {Prisma, PrismaClient, TeamMember, TeamRole} from '../generated/prisma/client';

export type {TeamMember, TeamRole};

/** 允许调用方传入事务客户端（tx），保证跨多次查询/写入的原子性；不传时默认走全局单例 */
type Client = PrismaClient | Prisma.TransactionClient;

export interface TeamMemberWithUser extends TeamMember {
  user: {id: string; username: string};
}

export function createTeamMember(
  teamId: string,
  userId: string,
  role: TeamRole,
  client: Client = prisma
): Promise<TeamMember> {
  return client.teamMember.create({data: {teamId, userId, role}});
}

export function findTeamMember(
  teamId: string,
  userId: string,
  client: Client = prisma
): Promise<TeamMember | null> {
  return client.teamMember.findUnique({where: {teamId_userId: {teamId, userId}}});
}

export function listTeamMembers(teamId: string): Promise<TeamMemberWithUser[]> {
  return prisma.teamMember.findMany({
    where: {teamId},
    orderBy: {createdAt: 'asc'},
    include: {user: {select: {id: true, username: true}}}
  });
}

/** 用于"最后一个 OWNER"保护判断，只统计角色为 OWNER 的成员数量（跟 wiki-member 的思路一致） */
export function countOwners(teamId: string, client: Client = prisma): Promise<number> {
  return client.teamMember.count({where: {teamId, role: 'OWNER'}});
}

/**
 * 找一个仍持有 OWNER 角色、且不是 excludeUserId 的成员（按加入时间最早排序）——
 * 用于成员退出团队时，把该成员名下唯一 OWNER 的 Wiki 转移给"当前团队最早加入的 OWNER"
 * （见 team-workspace-model design.md 决策 7）。
 */
export function findAnyOtherOwner(
  teamId: string,
  excludeUserId: string,
  client: Client = prisma
): Promise<TeamMember | null> {
  return client.teamMember.findFirst({
    where: {teamId, role: 'OWNER', userId: {not: excludeUserId}},
    orderBy: {createdAt: 'asc'}
  });
}

/** 找当前团队里最早加入且仍持有 OWNER 角色的成员（不排除任何人），用于所有权转移的接收方选择 */
export function findEarliestOwner(
  teamId: string,
  client: Client = prisma
): Promise<TeamMember | null> {
  return client.teamMember.findFirst({
    where: {teamId, role: 'OWNER'},
    orderBy: {createdAt: 'asc'}
  });
}

export function updateTeamMemberRole(
  teamId: string,
  userId: string,
  role: TeamRole,
  client: Client = prisma
): Promise<TeamMember> {
  return client.teamMember.update({
    where: {teamId_userId: {teamId, userId}},
    data: {role}
  });
}

export function deleteTeamMember(
  teamId: string,
  userId: string,
  client: Client = prisma
): Promise<TeamMember> {
  return client.teamMember.delete({where: {teamId_userId: {teamId, userId}}});
}

/**
 * 判断某用户是否为某 Team 的 OWNER——这是权限判断链路的第一层（见 design.md 决策 3，
 * `requireWikiRole` 改造为先查这个，再查 `WikiMember`）。
 */
export async function isTeamOwner(
  teamId: string,
  userId: string,
  client: Client = prisma
): Promise<boolean> {
  const member = await findTeamMember(teamId, userId, client);
  return member?.role === 'OWNER';
}
