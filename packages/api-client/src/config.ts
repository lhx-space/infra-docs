import type {AuthUser} from './services/auth';

/**
 * api-client 的运行时配置：由宿主（apps/web / apps/desktop）在启动时通过 `configureApiClient`
 * 注入。抽离出包后，这里不再直接 `import.meta.env`、也不依赖任何 store——token 的读取与
 * 会话的落地都通过下面三个回调交回宿主侧（`packages/core` 的 `bootstrapCore` 会把它们接到
 * `store/auth.ts` 上），从而让 api-client 保持"纯 HTTP 客户端"的边界。
 */
export interface ApiClientConfig {
  baseUrl: string;
  getAccessToken: () => string | null;
  onSessionRefreshed: (user: AuthUser, accessToken: string) => void;
  onSessionExpired: () => void;
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
