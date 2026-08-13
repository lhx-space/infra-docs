import {create} from 'zustand';
import * as uploadService from '@/services/upload';
import type {
  CreateWikiInput,
  UpdateWikiInfoInput,
  Wiki,
  WikiMember,
  WikiRole
} from '@/services/wiki';
import * as wikiService from '@/services/wiki';
import type {WikiJoinRequest} from '@/services/wiki-join-request';
import * as joinRequestService from '@/services/wiki-join-request';
import type {WikiShareLink} from '@/services/wiki-share-link';
import * as shareLinkService from '@/services/wiki-share-link';
import {usePinnedStore} from './pinned';

export type {
  CreateWikiInput,
  UpdateWikiInfoInput,
  Wiki,
  WikiJoinRequest,
  WikiMember,
  WikiRole,
  WikiShareLink
};

interface WikiState {
  wikis: Wiki[];
  loading: boolean;

  fetchWikis: () => Promise<void>;
  /** 登出/切换账号时调用（见 `store/auth.ts` 的 `clearSession`）：这个 store 是跨整个
   * SPA 生命周期存在的单例，不会随路由跳转到登录页而自动清空——如果不重置，新账号登录后
   * `Sidebar` 挂载时会看到 `wikis` 不是空数组（还是上一个用户的数据），`if (wikis.length
   * === 0) fetchWikis()` 这个"避免重复拉取"的判断会直接跳过重新拉取，导致 Sidebar 一直
   * 展示上一个用户的内容，直到某个操作恰好触发了重新拉取。 */
  reset: () => void;
  createWiki: (input: CreateWikiInput) => Promise<Wiki>;
  updateWikiInfo: (wikiId: string, input: UpdateWikiInfoInput) => Promise<Wiki>;
  deleteWiki: (wikiId: string) => Promise<void>;

  /** 成员/查找用户/上传图片这几个 action 只是 services 的薄转发，不往 store 里存状态——
   * 数据仅在打开的设置面板内短暂使用（组件内 useState），但仍必须走 store，遵循
   * "组件不直接 import services" 的统一约束（见 design.md 决策 8 的姊妹约束）。 */
  getWiki: (wikiId: string) => Promise<{wiki: Wiki; role: WikiRole}>;
  listMembers: (wikiId: string) => Promise<WikiMember[]>;
  addMember: (wikiId: string, userId: string, role: WikiRole) => Promise<WikiMember>;
  updateMemberRole: (wikiId: string, userId: string, role: WikiRole) => Promise<WikiMember>;
  removeMember: (wikiId: string, userId: string) => Promise<void>;
  uploadCoverImage: (file: File) => Promise<string>;
  transferWikiTeam: (wikiId: string, teamId: string) => Promise<Wiki>;

  createShareLink: (wikiId: string, role: WikiRole, expiresAt?: string) => Promise<WikiShareLink>;
  revokeShareLink: (wikiId: string, linkId: string) => Promise<void>;
  redeemShareLink: (token: string) => Promise<string>;

  createJoinRequest: (wikiId: string) => Promise<WikiJoinRequest>;
  listPendingJoinRequests: (wikiId: string) => Promise<WikiJoinRequest[]>;
  reviewJoinRequest: (
    wikiId: string,
    requestId: string,
    approve: boolean,
    role?: WikiRole
  ) => Promise<void>;
}

/**
 * Wiki 全局状态：`Sidebar` 和 `WikiList` 页面共享同一份列表数据，避免同样的 `GET /wikis`
 * 被拉两次（见 design.md 决策 7）——`Sidebar` 挂载时若 `wikis` 为空才触发一次 `fetchWikis`。
 */
export const useWikiStore = create<WikiState>(set => ({
  wikis: [],
  loading: false,

  fetchWikis: async () => {
    set({loading: true});
    try {
      const {wikis} = await wikiService.listWikis();
      set({wikis});
      // Wiki 可能因为被删除、或当前用户被移出成员而消失——每次拿到最新列表后顺手清理一次
      // 已失效的置顶记录，避免 Sidebar/WikiList 的置顶分区残留裸 UUID（见 design.md 决策 1）
      usePinnedStore.getState().pruneMissingWikis(wikis.map(w => w.id));
    } finally {
      set({loading: false});
    }
  },

  reset: () => set({wikis: [], loading: false}),

  createWiki: async input => {
    const {wiki} = await wikiService.createWiki(input);
    set(state => ({wikis: [wiki, ...state.wikis]}));
    return wiki;
  },

  updateWikiInfo: async (wikiId, input) => {
    const {wiki} = await wikiService.updateWikiInfo(wikiId, input);
    set(state => ({wikis: state.wikis.map(w => (w.id === wikiId ? wiki : w))}));
    return wiki;
  },

  deleteWiki: async wikiId => {
    await wikiService.deleteWiki(wikiId);
    set(state => ({wikis: state.wikis.filter(w => w.id !== wikiId)}));
  },

  getWiki: wikiId => wikiService.getWiki(wikiId),

  listMembers: async wikiId => {
    const {members} = await wikiService.listMembers(wikiId);
    return members;
  },

  addMember: async (wikiId, userId, role) => {
    const {member} = await wikiService.addMember(wikiId, userId, role);
    return member;
  },

  updateMemberRole: async (wikiId, userId, role) => {
    const {member} = await wikiService.updateMemberRole(wikiId, userId, role);
    return member;
  },

  removeMember: async (wikiId, userId) => {
    await wikiService.removeMember(wikiId, userId);
  },

  uploadCoverImage: async file => {
    const {url} = await uploadService.uploadImage(file);
    return url;
  },

  transferWikiTeam: async (wikiId, teamId) => {
    const {wiki} = await wikiService.transferWikiTeam(wikiId, teamId);
    set(state => ({wikis: state.wikis.map(w => (w.id === wikiId ? wiki : w))}));
    return wiki;
  },

  createShareLink: async (wikiId, role, expiresAt) => {
    const {link} = await shareLinkService.createShareLink(wikiId, role, expiresAt);
    return link;
  },

  revokeShareLink: async (wikiId, linkId) => {
    await shareLinkService.revokeShareLink(wikiId, linkId);
  },

  redeemShareLink: async token => {
    const {wikiId} = await shareLinkService.redeemShareLink(token);
    return wikiId;
  },

  createJoinRequest: async wikiId => {
    const {request} = await joinRequestService.createJoinRequest(wikiId);
    return request;
  },

  listPendingJoinRequests: async wikiId => {
    const {requests} = await joinRequestService.listPendingJoinRequests(wikiId);
    return requests;
  },

  reviewJoinRequest: async (wikiId, requestId, approve, role) => {
    await joinRequestService.reviewJoinRequest(wikiId, requestId, approve, role);
  }
}));

/** Sidebar/WikiCard 需要按 id 找名称时用这个，不需要重复写 `.find()` */
export function useWikiById(wikiId: string): Wiki | undefined {
  return useWikiStore(state => state.wikis.find(w => w.id === wikiId));
}
