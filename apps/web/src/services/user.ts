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

export interface UpdateProfileInput {
  nickname?: string;
  avatarUrl?: string;
  bio?: string;
}

/**
 * 保存当前登录用户的资料字段（昵称/头像/简介）。请求体只允许这三个字段，
 * gender/birthday/phone 不在暴露范围内（见 wiki-integration-gaps design.md 决策 6）。
 */
export function updateProfile(input: UpdateProfileInput): Promise<{profile: UserProfile}> {
  return http.patch<{profile: UserProfile}>('/me/profile', input);
}
