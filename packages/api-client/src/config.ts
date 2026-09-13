import type {AuthUser} from './services/auth';

/**
 * api-client 的运行时配置：由宿主（apps/web / apps/desktop）在启动时通过 `configureApiClient`
 * 注入。抽离出包后，这里不再直接 `import.meta.env`、也不依赖任何 store——token 的读取与
 * 会话的落地都通过下面三个回调交回宿主侧（`packages/core` 的 `bootstrapCore` 会把它们接到
 * `store/auth.ts` 上），从而让 api-client 保持"纯 HTTP 客户端"的边界。
 */
/** 移动端 bearer 鉴权模式的请求头：值需与后端 handlers/auth.ts 的 AUTH_MODE_HEADER 保持一致 */
export const AUTH_MODE_HEADER = 'x-auth-mode';
export const AUTH_MODE_BEARER = 'bearer';

export interface ApiClientConfig {
  baseUrl: string;
  getAccessToken: () => string | null;
  /** 会话刷新成功：第三个参数仅在 bearer 模式（移动端）下携带新的 refresh token */
  onSessionRefreshed: (user: AuthUser, accessToken: string, refreshToken?: string) => void;
  onSessionExpired: () => void;
  /** 鉴权模式：cookie（web/desktop，默认）或 bearer（移动端，refresh token 走 body） */
  authMode?: 'cookie' | 'bearer';
  /** bearer 模式：读取当前已存储的 refresh token（移动端 SecureStore） */
  getRefreshToken?: () => string | null;
}

let config: ApiClientConfig | null = null;

export function configureApiClient(next: ApiClientConfig): void {
  config = next;
}

export function getApiClientConfig(): ApiClientConfig {
  if (!config) {
    throw new Error('api-client 尚未配置，请先调用 configureApiClient()');
  }
  return config;
}
