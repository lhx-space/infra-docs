import {configureApiClient} from '@luhanxin/api-client';
import {type CoreConfig, configureCore} from './config';
import {useAuthStore} from './store/auth';

/**
 * core 的启动入口：把宿主注入的运行时配置落地，并把 api-client 的"取 token / 会话落地"
 * 三个回调接到 `store/auth.ts` 上（accessToken 只存内存，见 store/auth.ts 的注释）。
 * 必须在任何业务请求 / `initAuth` 之前调用——`apps/web`、`apps/desktop` 的薄宿主各自
 * 在 render 前调用它。
 */
export function bootstrapCore(config: CoreConfig): void {
  configureCore(config);
  configureApiClient({
    baseUrl: config.apiBaseUrl,
    aiBaseUrl: config.aiBaseUrl,
    getAccessToken: () => useAuthStore.getState().accessToken,
    onSessionRefreshed: (user, accessToken) =>
      useAuthStore.getState().setSession(user, accessToken),
    onSessionExpired: () => useAuthStore.getState().clearSession()
  });
}
