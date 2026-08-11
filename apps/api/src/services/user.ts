import {findUserWithProfile} from '../models/user';
import type {UserProfile} from '../models/user-profile';
import {type PublicUser, toPublicUser} from './auth';

/** `/me` 对外暴露的资料字段：只挑用户菜单展示需要的三项，不含 gender/birthday/phone */
export type PublicProfile = Pick<UserProfile, 'nickname' | 'avatarUrl' | 'bio'>;

export interface MeResult {
  user: PublicUser;
  profile: PublicProfile | null;
}

function toPublicProfile(profile: UserProfile | null): PublicProfile | null {
  if (!profile) return null;
  return {
    nickname: profile.nickname,
    avatarUrl: profile.avatarUrl,
    bio: profile.bio
  };
}

/**
 * 查询当前用户 + 关联的 UserProfile，组装成 `/me` 的响应体。
 * 用户不存在（如 token 校验通过但账号已被删除）时返回 `null`，由 handler 统一按 401 处理。
 */
export async function getMe(userId: string): Promise<MeResult | null> {
  const userWithProfile = await findUserWithProfile(userId);
  if (!userWithProfile) return null;

  const {profile, ...user} = userWithProfile;
  return {
    user: toPublicUser(user),
    profile: toPublicProfile(profile)
  };
}
