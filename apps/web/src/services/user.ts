import {http} from '@/network';
import type {AuthUser} from './auth';

export interface UserProfile {
  nickname: string | null;
  avatarUrl: string | null;
  bio: string | null;
}

export interface MeResponse {
  user: AuthUser;
  profile: UserProfile | null;
}

/**
 * 查询当前登录用户的详情信息（含 profile 资料），用于丰富用户菜单展示。
 * 请求去重由 `http.get` 在传输层自动处理，这里不需要重复关心。
 */
export function getMe(): Promise<MeResponse> {
  return http.get<MeResponse>('/me');
}

export interface LookupUserResult {
  id: string;
  username: string;
  avatarUrl: string | null;
}

/**
 * 按用户名或邮箱精确查找一个已注册用户，用于"添加 Wiki 成员"场景（见 wiki-workspace-console design.md 决策 6）。
 * 查不到时后端返回 404，交给调用方（`store/wiki.ts`）捕获 `ApiError` 后翻译成友好提示，这里不做特殊处理。
 */
export function lookupUser(identifier: string): Promise<LookupUserResult> {
  return http.get<LookupUserResult>(`/users/lookup?identifier=${encodeURIComponent(identifier)}`);
}
