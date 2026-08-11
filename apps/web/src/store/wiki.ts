import {create} from 'zustand';
import * as uploadService from '@/services/upload';
import type {LookupUserResult} from '@/services/user';
import * as userService from '@/services/user';
import type {
  CreateWikiInput,
  UpdateWikiInfoInput,
  Wiki,
  WikiMember,
  WikiRole
} from '@/services/wiki';
import * as wikiService from '@/services/wiki';
import {usePinnedStore} from './pinned';

export type {CreateWikiInput, UpdateWikiInfoInput, Wiki, WikiMember, WikiRole};

interface WikiState {
  wikis: Wiki[];
  loading: boolean;

  fetchWikis: () => Promise<void>;
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
  lookupUser: (identifier: string) => Promise<LookupUserResult>;
  uploadCoverImage: (file: File) => Promise<string>;
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

  lookupUser: identifier => userService.lookupUser(identifier),

  uploadCoverImage: async file => {
    const {url} = await uploadService.uploadImage(file);
    return url;
  }
}));

/** Sidebar/WikiCard 需要按 id 找名称时用这个，不需要重复写 `.find()` */
export function useWikiById(wikiId: string): Wiki | undefined {
  return useWikiStore(state => state.wikis.find(w => w.id === wikiId));
}
