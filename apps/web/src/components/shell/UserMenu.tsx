import {Check, LogOut, Monitor, Moon, Sun, SunMoon} from 'lucide-react';
import {useEffect, useState} from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import {getAvatarFallbackText} from '@/lib/avatar';
import {useAuthStore} from '@/store/auth';
import {useProfileStore} from '@/store/profile';
import {type ThemePreference, useThemeStore} from '@/store/theme';

const THEME_OPTIONS: Array<{value: ThemePreference; label: string; icon: typeof Sun}> = [
  {value: 'light', label: '浅色', icon: Sun},
  {value: 'dark', label: '深色', icon: Moon},
  {value: 'system', label: '跟随系统', icon: Monitor}
];

/**
 * `avatarUrl` 由后端在注册时就写好默认值（见 apps/api/src/services/auth.ts 的 buildDefaultAvatarUrl），
 * 前端不再需要"没有头像时怎么生成"这条规则——只需要处理两种边界：
 * profile 还没加载完成（`avatarUrl` 为空）、或图片加载失败（`onError`），两种情况都展示字母兜底。
 */
function UserAvatar({
  username,
  avatarUrl,
  className
}: {
  username: string;
  avatarUrl?: string | null;
  className: string;
}) {
  const [errored, setErrored] = useState(false);

  if (!avatarUrl || errored) {
    return (
      <div
        className={`flex shrink-0 items-center justify-center rounded-full bg-primary font-medium text-primary-foreground ${className}`}
      >
        {getAvatarFallbackText(username)}
      </div>
    );
  }

  return (
    <img
      src={avatarUrl}
      alt={username}
      className={`shrink-0 rounded-full bg-muted object-cover ${className}`}
      onError={() => setErrored(true)}
    />
  );
}

/**
 * 页面右上角固定悬浮的用户信息入口：头像本身是常驻可见 UI，挂载后立即静默拉取一次 /me
 * 让真实头像尽快就位；点击后弹出的菜单里额外展示 nickname/bio 等详情。
 * 独立于 Sidebar 挂载在 AppShell 层，不随 Sidebar 折叠/展开而消失。
 *
 * 资料数据（profile）读写走 `useProfileStore`，本组件不直接 import `services/user`——
 * "组件只能通过 store/hook 触发网络请求"是统一约束，不因为"当前只有这一处消费"而例外。
 *
 * 退出登录只调用 `logout()`，不手动 navigate('/login')：`AppShell`（本组件的挂载点）
 * 被 `RequireAuth` 包裹，`status` 变为 unauthenticated 后 `RequireAuth` 会声明式地
 * 重定向——"登出后去哪"这个决策只应该有 `RequireAuth` 这一处，这里重复 navigate
 * 只会变成第二份实现（见 components/auth/RequireAuth.tsx）。
 */
export function UserMenu() {
  const user = useAuthStore(state => state.user);
  const logout = useAuthStore(state => state.logout);
  const theme = useThemeStore(state => state.theme);
  const setTheme = useThemeStore(state => state.setTheme);
  const profile = useProfileStore(state => state.profile);
  const fetchProfile = useProfileStore(state => state.fetchProfile);

  // 只依赖 user?.id：后台定时静默刷新 token 会产生一个内容相同但引用不同的新 user 对象，
  // 不应因此重新拉取一次 /me——只有"登录的人真的变了"才需要重新请求。
  // 重复调用的去重（StrictMode 双 effect / 并发调用）由 network 层的 http.get 自动处理，
  // 这里只需要声明"何时触发"，不需要再手写 ignore 标记之类的样板代码。
  useEffect(() => {
    if (user?.id) void fetchProfile();
  }, [user?.id, fetchProfile]);

  if (!user) return null;

  const displayName = profile?.nickname || user.username;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex size-9 items-center justify-center rounded-full ring-1 ring-border ring-offset-2 ring-offset-background transition hover:ring-primary/50"
          aria-label="用户菜单"
        >
          <UserAvatar
            username={user.username}
            avatarUrl={profile?.avatarUrl}
            className="size-9 text-sm"
          />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="flex items-start gap-2 py-2 font-normal">
          <UserAvatar
            username={user.username}
            avatarUrl={profile?.avatarUrl}
            className="size-8 text-xs"
          />
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-sm font-medium">{displayName}</span>
            <span className="truncate text-xs text-muted-foreground">{user.email}</span>
            {profile?.bio ? (
              <span className="mt-1 line-clamp-2 text-xs text-muted-foreground">{profile.bio}</span>
            ) : null}
          </div>
        </DropdownMenuLabel>

        <DropdownMenuSeparator />

        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <SunMoon className="size-4" />
            Appearance
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            {THEME_OPTIONS.map(({value, label, icon: Icon}) => (
              <DropdownMenuItem key={value} onClick={() => setTheme(value)}>
                <Icon className="size-4" />
                {label}
                {theme === value ? <Check className="ml-auto size-4" /> : null}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuSeparator />

        <DropdownMenuItem variant="destructive" onClick={() => void logout()}>
          <LogOut className="size-4" />
          退出登录
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
