import {http} from '@/network';

export interface AuthUser {
  /** UUID v7 字符串（后端 apps/api 已从自增 Int 迁移到 UUID 主键） */
  id: string;
  email: string;
  username: string;
  status: 'ACTIVE' | 'DISABLED' | 'PENDING';
  createdAt: string;
  updatedAt: string;
}

export interface AuthResponse {
  user: AuthUser;
  accessToken: string;
}

/**
 * 鉴权相关的业务请求（登录/注册/登出）。只负责"发请求、拿结果"，不做任何错误码翻译、
 * 不依赖 zustand——会话状态如何落地、错误如何翻译成用户可读文案，都由调用方
 * （`store/auth.ts`）决定。这样 services/ 层保持纯粹，UI 层也不需要认识这一层
 * （见 `store/auth.ts` 里 `toFriendlyErrorMessage` 的注释）。
 *
 * 注意：`/auth/refresh` 没有单独的 service 方法——它需要跟"请求 401 后静默重试"共享同一份
 * 去重逻辑（避免并发触发 refresh token rotation 打架），唯一实现固定放在 `network/client.ts` 的
 * `refreshAccessToken()`，这里不重复一份实现。
 */

/** 登录：账号（邮箱或用户名）+ 密码 */
export function login(identifier: string, password: string): Promise<AuthResponse> {
  return http.post<AuthResponse>('/auth/login', {identifier, password});
}

/** 注册：后端不返回 token（见 openspec/changes/web-auth-integration/design.md），仅返回创建的用户 */
export function register(
  email: string,
  username: string,
  password: string
): Promise<{user: AuthUser}> {
  return http.post<{user: AuthUser}>('/auth/register', {email, username, password});
}

/** 登出：吊销当前 refresh token；httpOnly cookie 由浏览器自动携带，无需前端手动处理 */
export function logout(): Promise<unknown> {
  return http.post('/auth/logout');
}
