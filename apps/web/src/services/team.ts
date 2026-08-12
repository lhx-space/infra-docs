import {http} from '@/network';

export type TeamRole = 'OWNER' | 'MEMBER';

export interface Team {
  id: string;
  name: string;
  isPersonal: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TeamMember {
  id: string;
  teamId: string;
  userId: string;
  role: TeamRole;
  createdAt: string;
  user?: {id: string; username: string};
}

export interface TeamInvite {
  id: string;
  teamId: string;
  token: string;
  role: TeamRole;
  maxUses: number | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdBy: string;
  createdAt: string;
}

export interface TeamWikiDirectoryEntry {
  id: string;
  name: string;
  description: string | null;
  coverImage: string | null;
  allowJoinRequest: boolean;
  isMember: boolean;
}

/**
 * 对 `/teams` 系列接口的薄封装，风格对齐 `services/wiki.ts`：只负责"发请求、拿结果"，
 * 不做错误码翻译（翻译交给调用方 `store/team.ts`），不依赖 zustand。
 */
export function listMyTeams(): Promise<{teams: Team[]}> {
  return http.get<{teams: Team[]}>('/teams/mine');
}

export function createTeam(name: string): Promise<{team: Team}> {
  return http.post<{team: Team}>('/teams', {name});
}

export function getTeam(teamId: string): Promise<{team: Team; role: TeamRole}> {
  return http.get<{team: Team; role: TeamRole}>(`/teams/${teamId}`);
}

export function updateTeam(teamId: string, name: string): Promise<{team: Team}> {
  return http.patch<{team: Team}>(`/teams/${teamId}`, {name});
}

export function deleteTeam(teamId: string): Promise<{status: string}> {
  return http.delete<{status: string}>(`/teams/${teamId}`);
}

export function listTeamMembers(teamId: string): Promise<{members: TeamMember[]}> {
  return http.get<{members: TeamMember[]}>(`/teams/${teamId}/members`);
}

export function updateTeamMemberRole(
  teamId: string,
  userId: string,
  role: TeamRole
): Promise<{member: TeamMember}> {
  return http.patch<{member: TeamMember}>(`/teams/${teamId}/members/${userId}`, {role});
}

export function removeTeamMember(teamId: string, userId: string): Promise<{status: string}> {
  return http.delete<{status: string}>(`/teams/${teamId}/members/${userId}`);
}

export function listTeamWikis(teamId: string): Promise<{wikis: TeamWikiDirectoryEntry[]}> {
  return http.get<{wikis: TeamWikiDirectoryEntry[]}>(`/teams/${teamId}/wikis`);
}

export interface CreateInviteInput {
  maxUses?: number;
  expiresAt?: string;
}

export function createInvite(
  teamId: string,
  input: CreateInviteInput
): Promise<{invite: TeamInvite}> {
  return http.post<{invite: TeamInvite}>(`/teams/${teamId}/invites`, input);
}

export function revokeInvite(teamId: string, inviteId: string): Promise<{status: string}> {
  return http.delete<{status: string}>(`/teams/${teamId}/invites/${inviteId}`);
}

export function redeemInvite(token: string): Promise<{teamId: string}> {
  return http.post<{teamId: string}>(`/invites/${token}/redeem`);
}
