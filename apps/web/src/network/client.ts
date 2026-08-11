import type {AuthResponse} from '@/services/auth';
import {useAuthStore} from '@/store/auth';
import {dedupe} from './dedupe';
import {ApiError} from './errors';
import {fetchWithRetry} from './retry';
import type {HttpMethod} from './types';

const BASE_URL = import.meta.env.VITE_API_BASE_URL;

interface RequestOptions {
  method?: HttpMethod;
  body?: unknown;
  /** 仅供 /auth/refresh 自身使用：跳过 401 静默刷新拦截，避免刷新接口本身失败时死循环 */
  skipAuthRetry?: boolean;
  /** 可选的取消信号：调用方想在请求过程中主动放弃时传入（如组件卸载、搜索输入变化），
   * 传输层只负责透传给 fetch，不强加任何取消策略——由调用方决定要不要用、什么时候 abort */
  signal?: AbortSignal;
}

/**
 * `/auth/refresh` 的唯一触发入口。无论是"请求 401 后静默重试"还是
 * `store/auth.ts` 里"后台定时静默刷新"，都必须调用这一个函数——底层用 `dedupe()` 去重，
 * 后端 refresh 是先吊销旧 token 再签发新的一对（rotation），并发调用后到达的一次必然拿着
 * 已被吊销的旧 token 而失败，所以整个前端只能有一份"发起 refresh"的实现。
 *
 * 与 `rawRequest` 互相递归调用（rawRequest 收到 401 时调它，它内部又调 rawRequest 打
 * `/auth/refresh`），刻意放在同一个文件里，避免拆到不同模块后形成循环 import。
 */
export async function refreshAccessToken(): Promise<boolean> {
  return dedupe('auth:refresh', async () => {
    try {
      const data = await rawRequest<AuthResponse>('/auth/refresh', {
        method: 'POST',
        skipAuthRetry: true
      });
      useAuthStore.getState().setSession(data.user, data.accessToken);
      return true;
    } catch {
      useAuthStore.getState().clearSession();
      return false;
    }
  });
}

async function rawRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const {method = 'GET', body, skipAuthRetry = false} = options;
  const accessToken = useAuthStore.getState().accessToken;

  const {signal} = options;
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  const response = await fetchWithRetry(
    `${BASE_URL}${path}`,
    {
      method,
      headers,
      // 跨域携带 httpOnly 的 refresh_token cookie，需配合后端 cors({ credentials: true })
      credentials: 'include',
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal
    },
    method
  );

  // 只有「带着 accessToken 发起的请求」收到 401 才代表 token 过期，需要静默刷新重试；
  // 未带 token 的请求（如登录密码错误）收到 401 单纯是业务错误，不应触发刷新。
  if (response.status === 401 && accessToken && !skipAuthRetry) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      return rawRequest<T>(path, {...options, skipAuthRetry: true});
    }
  }

  const contentType = response.headers.get('content-type') ?? '';
  const payload = contentType.includes('application/json') ? await response.json() : undefined;

  if (!response.ok) {
    const message =
      (payload as {error?: string} | undefined)?.error ?? response.statusText ?? 'request_failed';
    const details = (payload as {details?: unknown} | undefined)?.details;
    throw new ApiError(response.status, message, details);
  }

  return payload as T;
}

export const http = {
  /**
   * `GET` 请求默认按 `path` 自动去重（Singleflight）：同一时刻的并发调用共享同一个
   * in-flight 请求，业务层不需要、也不能忘记自己再包一层 `dedupe()`——这是传输层对
   * "GET 天然幂等、结果理应共享"这一 HTTP 语义的统一兜底，而不是靠每个调用方自觉遵守。
   * `POST`/`PUT`/`DELETE` 等有副作用的请求不做这个默认行为，是否去重由调用方自己决定
   * （如 `refreshAccessToken` 出于 token rotation 的特殊原因显式调用 `dedupe`）。
   */
  get: <T>(path: string, options?: Pick<RequestOptions, 'signal'>): Promise<T> =>
    dedupe(`GET:${path}`, () => rawRequest<T>(path, {...options, method: 'GET'})),
  post: <T>(
    path: string,
    body?: unknown,
    options?: Omit<RequestOptions, 'method' | 'body'>
  ): Promise<T> => rawRequest<T>(path, {...options, method: 'POST', body})
};
