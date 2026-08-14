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

const CURRENT_TEAM_STORAGE_KEY = 'current-team-id';

function readStoredCurrentTeamId(): string | null {
  return localStorage.getItem(CURRENT_TEAM_STORAGE_KEY);
}

function persistCurrentTeamId(teamId: string): void {
  localStorage.setItem(CURRENT_TEAM_STORAGE_KEY, teamId);
}

interface TeamState {
  teams: Team[];
  loading: boolean;

  /** 当前团队上下文，用于筛选 Sidebar/Wiki 列表页展示的内容（见 team-switcher design.md 决策 1）。
   * 纯前端状态，不落库，持久化在 localStorage，模式跟 `store/pinned.ts`/`store/shell.ts` 一致。 */
  currentTeamId: string | null;
  setCurrentTeamId: (teamId: string) => void;

  fetchMyTeams: () => Promise<void>;
  /** 登出/切换账号时调用（见 `store/auth.ts` 的 `clearSession`，跟 `store/wiki.ts`
   * 的 `reset` 是同一个理由）：只重置 `teams`，不动 `currentTeamId`——它已经持久化在
   * localStorage 里，新账号登录后下一次 `fetchMyTeams` 会自己校验这个值是否仍然属于
   * 新账号的团队列表并回退（见下方 `fetchMyTeams` 里的兜底逻辑），这里不需要抢先处理。 */
  reset: () => void;
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
export const useTeamStore = create<TeamState>((set, get) => ({
  teams: [],
  loading: false,
  currentTeamId: readStoredCurrentTeamId(),

  setCurrentTeamId: teamId => {
    persistCurrentTeamId(teamId);
    set({currentTeamId: teamId});
  },

  fetchMyTeams: async () => {
    set({loading: true});
    try {
      const {teams} = await teamService.listMyTeams();
      set({teams});
      // localStorage 里记的 currentTeamId 可能已经失效（比如被移出了那个团队，或者是
      // 上一个账号登录时留下的值）——这里统一做一次兜底回退，不需要在每个读取
      // currentTeamId 的组件里各自判断一遍（见 team-switcher design.md 决策 1/2）。
      const current = get().currentTeamId;
      const stillValid = current !== null && teams.some(t => t.id === current);
      if (!stillValid) {
        const fallback = teams.find(t => t.isPersonal)?.id ?? teams[0]?.id ?? null;
        if (fallback) {
          persistCurrentTeamId(fallback);
          set({currentTeamId: fallback});
        }
      }
    } finally {
      set({loading: false});
    }
  },

  reset: () => set({teams: [], loading: false}),

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
    // 兑换成功后立即刷新 `teams`——不这么做的话，Sidebar/TeamSwitcher/SearchDialog
    // 等常驻组件读到的还是兑换前的旧数组（它们各自的懒加载 effect 只在数组为空时才
    // fetch，兑换新团队后数组显然非空，不会自己触发），新加入的团队要等用户手动刷
    // 整页才会出现。用 catch 吞掉刷新本身的失败——兑换这个动作已经成功落库了，
    // 不该因为紧随其后的一次读请求失败而让整个 redeemInvite 返回失败。
    await get()
      .fetchMyTeams()
      .catch(() => {});
    return teamId;
  }
}));

/** 当前团队的完整对象（不只是 id），Sidebar/切换器/创建 Wiki 等场景直接用它取名字展示，
 * 不需要在每个消费点各自 `.find()` 一遍。 */
export function useCurrentTeam(): Team | undefined {
  return useTeamStore(state => state.teams.find(t => t.id === state.currentTeamId));
}
