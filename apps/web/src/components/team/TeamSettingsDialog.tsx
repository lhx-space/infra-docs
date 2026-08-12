import {useEffect, useState} from 'react';
import {Dialog, DialogContent, DialogHeader, DialogTitle} from '@/components/ui/dialog';
import {cn} from '@/lib/utils';
import type {Team, TeamRole} from '@/store/team';
import {useTeamStore} from '@/store/team';
import {TeamBasicInfoTab} from './TeamBasicInfoTab';
import {TeamInviteTab} from './TeamInviteTab';
import {TeamMembersTab} from './TeamMembersTab';

interface TeamSettingsDialogProps {
  team: Team | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type TabKey = 'basic' | 'members' | 'invite';

const ALL_TABS: Array<{key: TabKey; label: string}> = [
  {key: 'basic', label: 'Basic Information'},
  {key: 'members', label: 'Members'},
  {key: 'invite', label: 'Invite'}
];

/**
 * 团队设置面板：结构对齐 `WikiSettingsDialog`（Dialog + Tab + 打开时拉一次角色）。
 * Invite Tab 只有 `OWNER` 才展示——生成/失效邀请链接的接口本身就要求 `OWNER`。
 */
export function TeamSettingsDialog({team, open, onOpenChange}: TeamSettingsDialogProps) {
  const getTeam = useTeamStore(state => state.getTeam);
  const [role, setRole] = useState<TeamRole | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>('basic');

  useEffect(() => {
    if (!open || !team) {
      setRole(null);
      return;
    }
    setActiveTab('basic');
    getTeam(team.id)
      .then(res => setRole(res.role))
      .catch(() => setRole(null));
  }, [open, team, getTeam]);

  if (!team) return null;

  const canManage = role === 'OWNER';
  const tabs = ALL_TABS.filter(tab => tab.key !== 'invite' || canManage);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="truncate">{team.name} · 设置</DialogTitle>
        </DialogHeader>

        <div className="flex gap-1 border-b">
          {tabs.map(tab => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={cn(
                'border-b-2 px-3 py-2 text-sm font-medium text-muted-foreground transition-colors',
                activeTab === tab.key
                  ? 'border-primary text-foreground'
                  : 'border-transparent hover:text-foreground'
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {role === null ? (
          <p className="py-8 text-center text-sm text-muted-foreground">加载中...</p>
        ) : activeTab === 'basic' ? (
          <TeamBasicInfoTab
            team={team}
            canEdit={canManage}
            canDelete={canManage}
            onDeleted={() => onOpenChange(false)}
          />
        ) : activeTab === 'members' ? (
          <TeamMembersTab team={team} canManage={canManage} />
        ) : (
          <TeamInviteTab team={team} />
        )}
      </DialogContent>
    </Dialog>
  );
}
