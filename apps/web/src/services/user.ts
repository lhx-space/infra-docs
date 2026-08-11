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
