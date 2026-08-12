import {create} from 'zustand';
import type {
  CreateInviteInput,
  Team,
  TeamInvite,
  TeamMember,
  TeamRole,
  TeamWikiDirectoryEntry
} from '@/services/team';
import * as teamService from '@/services/team';

export type {CreateInviteInput, Team, TeamInvite, TeamMember, TeamRole, TeamWikiDirectoryEntry};

interface TeamState {
  teams: Team[];
  loading: boolean;

  fetchMyTeams: () => Promise<void>;
  createTeam: (name: string) => Promise<Team>;
  updateTeamName: (teamId: string, name: string) => Promise<Team>;
  deleteTeam: (teamId: string) => Promise<void>;

  /** 成员/邀请链接/团队工作区目录这几个 action 只是 services 的薄转发，不往 store 里存状态——
   * 数据仅在打开的团队管理面板内短暂使用（组件内 useState），但仍必须走 store，遵循
   * "组件不直接 import services" 的统一约束（跟 store/wiki.ts 的约束一致）。 */
  getTeam: (teamId: string) => Promise<{team: Team; role: TeamRole}>;
  listMembers: (teamId: string) => Promise<TeamMember[]>;
  updateMemberRole: (teamId: string, userId: string, role: TeamRole) => Promise<TeamMember>;
  removeMember: (teamId: string, userId: string) => Promise<void>;
  listTeamWikis: (teamId: string) => Promise<TeamWikiDirectoryEntry[]>;
  createInvite: (teamId: string, input: CreateInviteInput) => Promise<TeamInvite>;
  revokeInvite: (teamId: string, inviteId: string) => Promise<void>;
  redeemInvite: (token: string) => Promise<string>;
}

/**
 * Team 全局状态：`teams` 是"我所属的全部团队"（含个人 Team），用于创建 Wiki 时的归属选择器、
 * Sidebar 的团队入口等场景共享，避免同样的 `GET /teams/mine` 被拉两次
 * （跟 `store/wiki.ts` 的 `wikis` 共享思路一致）。
 */
export const useTeamStore = create<TeamState>(set => ({
  teams: [],
  loading: false,

  fetchMyTeams: async () => {
    set({loading: true});
    try {
      const {teams} = await teamService.listMyTeams();
      set({teams});
    } finally {
      set({loading: false});
    }
  },

  createTeam: async name => {
    const {team} = await teamService.createTeam(name);
    set(state => ({teams: [...state.teams, team]}));
    return team;
  },

  updateTeamName: async (teamId, name) => {
    const {team} = await teamService.updateTeam(teamId, name);
    set(state => ({teams: state.teams.map(t => (t.id === teamId ? team : t))}));
    return team;
  },

  deleteTeam: async teamId => {
    await teamService.deleteTeam(teamId);
    set(state => ({teams: state.teams.filter(t => t.id !== teamId)}));
  },

  getTeam: teamId => teamService.getTeam(teamId),

  listMembers: async teamId => {
    const {members} = await teamService.listTeamMembers(teamId);
    return members;
  },

  updateMemberRole: async (teamId, userId, role) => {
    const {member} = await teamService.updateTeamMemberRole(teamId, userId, role);
    return member;
  },

  removeMember: async (teamId, userId) => {
    await teamService.removeTeamMember(teamId, userId);
  },

  listTeamWikis: async teamId => {
    const {wikis} = await teamService.listTeamWikis(teamId);
    return wikis;
  },

  createInvite: async (teamId, input) => {
    const {invite} = await teamService.createInvite(teamId, input);
    return invite;
  },

  revokeInvite: async (teamId, inviteId) => {
    await teamService.revokeInvite(teamId, inviteId);
  },

  redeemInvite: async token => {
    const {teamId} = await teamService.redeemInvite(token);
    return teamId;
  }
}));
