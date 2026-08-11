/** 头像加载失败、或还没有可用头像 URL 时的兜底展示：用户名首字母（大写） */
export function getAvatarFallbackText(username: string): string {
  return username.slice(0, 1).toUpperCase();
}
