import {create} from 'zustand';
import {getMe, type UserProfile} from '@/services/user';

export type {UserProfile};

interface ProfileState {
  profile: UserProfile | null;
  fetchProfile: () => Promise<void>;
  clearProfile: () => void;
}

/**
 * 当前登录用户的资料信息（nickname/avatarUrl/bio），供 `UserMenu` 展示。
 *
 * 独立于 `useAuthStore`（保持 auth store 只管鉴权本身，不越界承担资料展示状态），
 * 但生命周期跟随登录态：`useAuthStore.clearSession()`（登出/静默刷新失败）时会
 * 一并调用 `clearProfile()`，避免同一浏览器标签页换了账号后残留上一个人的资料。
 *
 * 之所以从组件局部 `useState` 提升成独立 store（而不是像最初 YAGNI 决策那样留在
 * `UserMenu` 内部）：为了满足"组件永远不直接 import services，只能通过 store/hook"
 * 这条统一约束——`getMe()` 这个网络请求必须有个 store/hook 包一层，UI 层不能直接摸到
 * `services/`，不管这份数据当前有几个消费者。
 *
 * `fetchProfile` 失败静默降级（保留原有 `profile`，UI 退回到只展示 username/email）；
 * 请求去重已经在 `network/` 层的 `http.get` 自动完成，这里不需要重复处理。
 */
export const useProfileStore = create<ProfileState>(set => ({
  profile: null,

  fetchProfile: async () => {
    try {
      const data = await getMe();
      set({profile: data.profile});
    } catch {
      // 静默失败：保留调用前的 profile（可能是 null，也可能是上一次成功拉取的结果）
    }
  },

  clearProfile: () => set({profile: null})
}));
