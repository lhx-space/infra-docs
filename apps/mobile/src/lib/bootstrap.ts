import {configureApiClient} from '@luhanxin/api-client';
import {useAuthStore} from '../store/auth';
import {API_BASE_URL} from './config';
import {setStoredRefreshToken} from './token-store';

/**
 * 移动端启动装配：把 api-client 配置成 bearer 鉴权模式（refresh token 走请求/响应 body，
 * 见 packages/api-client 的 authMode 支持）。
 *
 * - accessToken 只存内存（跟 web/desktop 一致，见 packages/core store/auth.ts 注释）
 * - refreshToken 持久化到 expo-secure-store；api-client 的 getRefreshToken 是同步签名，
 *   所以这里读的是 auth store 里的内存快照（启动时由 initAuth 先从 SecureStore 载入）。
 */
export function bootstrapMobile(): void {
  configureApiClient({
    baseUrl: API_BASE_URL,
    authMode: 'bearer',
    getAccessToken: () => useAuthStore.getState().accessToken,
    getRefreshToken: () => useAuthStore.getState().refreshToken,
    onSessionRefreshed: (user, accessToken, refreshToken) => {
      useAuthStore.getState().setSession(user, accessToken, refreshToken ?? null);
      if (refreshToken) void setStoredRefreshToken(refreshToken);
    },
    onSessionExpired: () => useAuthStore.getState().clearSession()
  });
}
