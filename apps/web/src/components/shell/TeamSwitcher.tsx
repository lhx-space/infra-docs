import {Check, ChevronsUpDown, FolderOpen, Plus, Settings, Users} from 'lucide-react';
import {useState} from 'react';
import {Link} from 'react-router-dom';
import {CreateTeamDialog} from '@/components/team/CreateTeamDialog';
import {TeamSettingsDialog} from '@/components/team/TeamSettingsDialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import type {Team} from '@/store/team';
import {useCurrentTeam, useTeamStore} from '@/store/team';

/**
 * Sidebar 顶部的团队切换器：替代原本平铺展示 + 点击跳转目录页的团队列表。
 *
 * 选中某个团队只是切换本地的 `currentTeamId`（见 store/team.ts），不发生路由跳转、
 * 不重新拉取数据——`Sidebar` 下方的 Wiki 分区会基于内存里已有的 `wikis` 重新过滤，
 * 感知上是瞬时的（见 team-switcher design.md 决策 1/2）。
 *
 * 每个团队行末尾保留"设置"和"浏览目录"两个操作入口（点击时 stopPropagation，不触发切换），
 * 对应原来平铺列表里 hover 出现的设置齿轮和跳转目录页的行为，只是挪进了下拉菜单里。
 */
export function TeamSwitcher() {
  const teams = useTeamStore(state => state.teams);
  const setCurrentTeamId = useTeamStore(state => state.setCurrentTeamId);
  const currentTeam = useCurrentTeam();

  const [open, setOpen] = useState(false);
  const [createTeamOpen, setCreateTeamOpen] = useState(false);
  const [settingsTeam, setSettingsTeam] = useState<Team | null>(null);

  const currentLabel = currentTeam
    ? currentTeam.isPersonal
      ? '个人空间'
      : currentTeam.name
    : '选择团队';

  return (
    <>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-sidebar-accent"
          >
            <Users className="size-4 shrink-0" />
            <span className="min-w-0 flex-1 truncate text-left font-medium">{currentLabel}</span>
            <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="start" className="w-64">
          {teams.map(team => {
            const label = team.isPersonal ? '个人空间' : team.name;
            const isCurrent = team.id === currentTeam?.id;
            return (
              <DropdownMenuItem
                key={team.id}
                onSelect={() => setCurrentTeamId(team.id)}
                className="group justify-between gap-2"
              >
                <span className="flex min-w-0 flex-1 items-center gap-2">
                  <Check
                    className={isCurrent ? 'size-3.5 shrink-0' : 'size-3.5 shrink-0 opacity-0'}
                  />
                  <span className="truncate">{label}</span>
                </span>
                <span className="flex shrink-0 items-center gap-1 opacity-0 group-hover:opacity-100">
                  {team.isPersonal ? null : (
                    <Link
                      to={`/teams/${team.id}/wikis`}
                      onClick={e => e.stopPropagation()}
                      aria-label="浏览团队工作区目录"
                      className="rounded p-1 hover:bg-accent-foreground/10"
                    >
                      <FolderOpen className="size-3.5" />
                    </Link>
                  )}
                  <button
                    type="button"
                    aria-label="团队设置"
                    className="rounded p-1 hover:bg-accent-foreground/10"
                    onClick={e => {
                      e.stopPropagation();
                      setSettingsTeam(team);
                    }}
                  >
                    <Settings className="size-3.5" />
                  </button>
                </span>
              </DropdownMenuItem>
            );
          })}

          <DropdownMenuSeparator />

          <DropdownMenuItem onSelect={() => setCreateTeamOpen(true)}>
            <Plus className="size-3.5" />
            新建团队
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <CreateTeamDialog open={createTeamOpen} onOpenChange={setCreateTeamOpen} />
      <TeamSettingsDialog
        team={settingsTeam}
        open={settingsTeam !== null}
        onOpenChange={next => {
          if (!next) setSettingsTeam(null);
        }}
      />
    </>
  );
}
