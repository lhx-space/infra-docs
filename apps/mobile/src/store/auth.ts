import {
  ApiError,
  type AuthUser,
  loginBearer,
  logoutBearer,
  refreshAccessToken,
  register as registerRequest
} from '@luhanxin/api-client';
import {create} from 'zustand';
import {getStoredRefreshToken, setStoredRefreshToken} from '../lib/token-store';
import {useDocumentStore} from './document';
import {useSearchStore} from './search';
import {useTeamStore} from './team';

export type AuthStatus = 'idle' | 'loading' | 'authenticated' | 'unauthenticated';

/** 后端 `{ error: string }` 错误码 → 用户可读文案，与 web/desktop（packages/core store/auth.ts）保持一致 */
const AUTH_ERROR_MESSAGES: Record<string, string> = {
  invalid_credentials: '账号或密码错误',
  email_or_username_taken: '邮箱或用户名已被占用',
  invalid_refresh_token: '登录状态已失效，请重新登录',
  invalid_input: '输入信息不合法，请检查后重试'
};

/** 把 ApiError 翻译成用户可读文案；未知错误走 fallback */
function toFriendlyError(error: unknown, fallback: string): Error {
  if (error instanceof ApiError) {
    return new Error(AUTH_ERROR_MESSAGES[error.message] ?? fallback);
  }
  return new Error(fallback);
}

interface AuthState {
  user: AuthUser | null;
  accessToken: string | null;
  refreshToken: string | null;
  status: AuthStatus;
  setSession: (user: AuthUser, accessToken: string, refreshToken: string | null) => void;
  clearSession: () => void;
  initAuth: () => Promise<void>;
  login: (identifier: string, password: string) => Promise<void>;
  register: (email: string, username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  accessToken: null,
  refreshToken: null,
  status: 'idle',

  setSession: (user, accessToken, refreshToken) => {
    set({user, accessToken, refreshToken, status: 'authenticated'});
    if (refreshToken) void setStoredRefreshToken(refreshToken);
  },

  clearSession: () => {
    // 登出/会话失效时清掉浏览态 store，避免切换账号后仍展示上一个用户的数据（对齐 web 的处理）
    useTeamStore.getState().reset();
    useDocumentStore.getState().reset();
    useSearchStore.getState().reset();
    set({user: null, accessToken: null, refreshToken: null, status: 'unauthenticated'});
    void setStoredRefreshToken(null);
  },

  initAuth: async () => {
    set({status: 'loading'});
    // 先把上次的 refresh token 从 SecureStore 读进内存，再走统一的 bearer 刷新流程；
    // 成功/失败分别由 bootstrap 里配置的 onSessionRefreshed / onSessionExpired 落地最终状态。
    const stored = await getStoredRefreshToken();
    if (stored) set({refreshToken: stored});
    await refreshAccessToken();
  },

  login: async (identifier, password) => {
    try {
      const data = await loginBearer(identifier, password);
      get().setSession(data.user, data.accessToken, data.refreshToken ?? null);
    } catch (err) {
      throw toFriendlyError(err, '登录失败，请稍后重试');
    }
  },

  register: async (email, username, password) => {
    try {
      await registerRequest(email, username, password);
    } catch (err) {
      throw toFriendlyError(err, '注册失败，请稍后重试');
    }
    await get().login(username, password);
  },

  logout: async () => {
    try {
      await logoutBearer(get().refreshToken);
    } finally {
      get().clearSession();
    }
  }
}));
