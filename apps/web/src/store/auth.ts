import {create} from 'zustand';
import {getJwtExpiryMs} from '@/lib/jwt';
import {ApiError, refreshAccessToken} from '@/network';
import type {AuthUser} from '@/services/auth';
import * as authService from '@/services/auth';
import {useProfileStore} from './profile';

export type {AuthUser};
export type AuthStatus = 'idle' | 'loading' | 'authenticated' | 'unauthenticated';

/** 到期前提前多久触发后台静默刷新，避免刚好卡在过期边界上产生竞态 */
const REFRESH_BUFFER_MS = 30_000;
/** JWT 解析失败等异常情况下的兜底刷新间隔（access token 默认 TTL 是 15m，取一个明显更短的值兜底） */
const FALLBACK_REFRESH_MS = 5 * 60 * 1000;

/** 后端 `{ error: string }` 错误码 → 用户可读中文文案，未知错误码走各 action 自己的 fallback */
const AUTH_ERROR_MESSAGES: Record<string, string> = {
  invalid_credentials: '账号或密码错误',
  email_or_username_taken: '邮箱或用户名已被占用',
  invalid_refresh_token: '登录状态已失效，请重新登录',
  invalid_input: '输入信息不合法，请检查后重试'
};

/**
 * 把 `services/auth.ts` 抛出的 `ApiError`（或任何未知异常）翻译成用户可读文案，
 * 包装成普通 `Error` 重新抛出。刻意放在 store 这一层、不导出给 UI：
 * `Login.tsx`/`Register.tsx` 只需要 `catch (err) { err.message }`，完全不需要知道
 * `ApiError`/错误码字典的存在——这是"组件不直接 import services"这条约束的另一半：
 * 组件不仅不该直接调用 service 函数，也不该需要认识 service 层的错误类型才能展示错误。
 */
function toFriendlyError(error: unknown, fallback: string): Error {
  if (error instanceof ApiError) {
    return new Error(AUTH_ERROR_MESSAGES[error.message] ?? fallback);
  }
  return new Error(fallback);
}

interface AuthState {
  user: AuthUser | null;
  accessToken: string | null;
  status: AuthStatus;
  setSession: (user: AuthUser, accessToken: string) => void;
  clearSession: () => void;
  initAuth: () => Promise<void>;
  login: (identifier: string, password: string) => Promise<void>;
  register: (email: string, username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

let backgroundRefreshTimer: ReturnType<typeof setTimeout> | null = null;

function cancelBackgroundRefresh(): void {
  if (backgroundRefreshTimer) {
    clearTimeout(backgroundRefreshTimer);
    backgroundRefreshTimer = null;
  }
}

/**
 * 安排下一次后台静默刷新：解析 access token 的 `exp`，提前 `REFRESH_BUFFER_MS` 调用
 * `refreshAccessToken()`（与请求 401 重试共用同一份去重实现）。
 *
 * 目的：覆盖"标签页开着但用户完全不操作、也没有任何业务请求触发 401"的场景——
 * 没有这个定时器的话，refresh token 只会在业务请求 401 时被动续期（rotation），
 * 长时间挂机不发任何请求会导致 refresh token 也真的过期，被强制登出。
 * 有了它，只要标签页开着，access token 到期前就会自动刷新一次，refresh token 也随之
 * rotation 续期，7 天窗口不断往后滑动。
 */
function scheduleBackgroundRefresh(accessToken: string): void {
  cancelBackgroundRefresh();

  const expiryMs = getJwtExpiryMs(accessToken);
  const delay =
    expiryMs !== null
      ? Math.max(expiryMs - Date.now() - REFRESH_BUFFER_MS, 0)
      : FALLBACK_REFRESH_MS;

  backgroundRefreshTimer = setTimeout(() => {
    void refreshAccessToken();
  }, delay);
}

/**
 * 鉴权状态管理。accessToken 仅存内存，不落 localStorage（见 openspec/changes/web-auth-integration/design.md）。
 * 实际的鉴权 HTTP 请求交给 `services/auth.ts`（登录/注册/登出）和 `network/client.ts`（refresh，见其中注释），
 * 这里只负责把结果落地成状态、并维护后台静默刷新的定时器。
 */
export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  accessToken: null,
  status: 'idle',

  setSession: (user, accessToken) => {
    set({user, accessToken, status: 'authenticated'});
    scheduleBackgroundRefresh(accessToken);
  },

  clearSession: () => {
    cancelBackgroundRefresh();
    useProfileStore.getState().clearProfile();
    set({user: null, accessToken: null, status: 'unauthenticated'});
  },

  initAuth: async () => {
    set({status: 'loading'});
    // 利用 httpOnly 的 refresh_token cookie 静默换取新的 accessToken，恢复会话；
    // 复用 network/client.ts 的 refreshAccessToken，成功/失败时会自动调用 setSession/clearSession。
    await refreshAccessToken();
  },

  login: async (identifier, password) => {
    try {
      const data = await authService.login(identifier, password);
      get().setSession(data.user, data.accessToken);
    } catch (err) {
      throw toFriendlyError(err, '登录失败，请稍后重试');
    }
  },

  register: async (email, username, password) => {
    // 注册接口不返回 token，成功后自动用刚注册的账号登录一次；
    // register 请求本身的错误用"注册失败"兜底文案，登录失败（理论上几乎不会发生）
    // 复用 login 自己的 toFriendlyError，不在这里重复包装。
    try {
      await authService.register(email, username, password);
    } catch (err) {
      throw toFriendlyError(err, '注册失败，请稍后重试');
    }
    await get().login(username, password);
  },

  logout: async () => {
    try {
      await authService.logout();
    } finally {
      get().clearSession();
    }
  }
}));
