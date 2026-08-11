import type {AuthUser} from '@/services/auth';

/**
 * 生成用户头像 URL。
 * 优先使用 `avatarUrl`（来自 `/me` 返回的 profile 资料，真实头像）；
 * 不存在时回退到 DiceBear 按 username 作为 seed 生成的确定性头像——
 * 同一用户每次展示的默认头像保持一致，不会每次刷新都变。
 */
export function getAvatarUrl(user: Pick<AuthUser, 'username'>, avatarUrl?: string | null): string {
  if (avatarUrl) return avatarUrl;
  const seed = encodeURIComponent(user.username);
  return `https://api.dicebear.com/9.x/glass/svg?seed=${seed}`;
}

/** 头像加载失败时的兜底展示：用户名首字母（大写） */
export function getAvatarFallbackText(username: string): string {
  return username.slice(0, 1).toUpperCase();
}
