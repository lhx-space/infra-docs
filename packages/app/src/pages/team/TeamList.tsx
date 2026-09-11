import type {Team} from '@luhanxin/core';
import {formatDate, useTeamStore} from '@luhanxin/core';
import {Button, DataTable, type DataTableColumn} from '@luhanxin/ui';
import {Plus, Settings} from 'lucide-react';
import {useEffect, useState} from 'react';
import {useNavigate} from 'react-router-dom';
import {PageHeader} from '@/components/shell/PageHeaderContext';
import {CreateTeamDialog} from '@/components/team/CreateTeamDialog';
import {TeamSettingsDialog} from '@/components/team/TeamSettingsDialog';

/**
 * 团队数据表：列出当前用户所属的全部团队（含个人空间），展示成员数/Wiki 数/文档总数等
 * 后台统计数据，点行进入该团队的「工作区目录」页，行内保留设置入口。
 */
export default function TeamList() {
  const navigate = useNavigate();
  const teams = useTeamStore(state => state.teams);
  const fetchMyTeams = useTeamStore(state => state.fetchMyTeams);
  const [createOpen, setCreateOpen] = useState(false);
  const [settingsTeam, setSettingsTeam] = useState<Team | null>(null);

  useEffect(() => {
    if (teams.length === 0) void fetchMyTeams();
  }, [teams.length, fetchMyTeams]);

  const columns: Array<DataTableColumn<Team>> = [
    {
      key: 'name',
      header: '名称',
      render: team => (
        <span className="font-medium">{team.isPersonal ? '个人空间' : team.name}</span>
      )
    },
    {
      key: 'type',
      header: '类型',
      render: team => (
        <span className="text-muted-foreground">{team.isPersonal ? '个人' : '团队'}</span>
      )
    },
    {
      key: 'members',
      header: '成员',
      className: 'text-right',
      render: team => <span className="tabular-nums">{team.memberCount ?? 0}</span>
    },
    {
      key: 'wikis',
      header: 'Wiki',
      className: 'text-right',
      render: team => <span className="tabular-nums">{team.wikiCount ?? 0}</span>
    },
    {
      key: 'documents',
      header: '文档',
      className: 'text-right',
      render: team => <span className="tabular-nums">{team.documentCount ?? 0}</span>
    },
    {
      key: 'createdAt',
      header: '创建时间',
      render: team => <span className="text-muted-foreground">{formatDate(team.createdAt)}</span>
    },
    {
      key: 'actions',
      header: '',
      className: 'w-20 text-right',
      render: team => (
        <div className="flex items-center justify-end gap-1">
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="团队设置"
            onClick={e => {
              e.stopPropagation();
              setSettingsTeam(team);
            }}
          >
            <Settings className="size-3.5" />
          </Button>
        </div>
      )
    }
  ];

  const createButton = (
    <Button onClick={() => setCreateOpen(true)}>
      <Plus className="size-4" />
      新建团队
    </Button>
  );

  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <PageHeader title="团队" actions={createButton} />

      <DataTable
        columns={columns}
        rows={teams}
        rowKey={team => team.id}
        onRowClick={team => navigate(`/teams/${team.id}/wikis`)}
      />

      <CreateTeamDialog open={createOpen} onOpenChange={setCreateOpen} />
      <TeamSettingsDialog
        team={settingsTeam}
        open={settingsTeam !== null}
        onOpenChange={next => {
          if (!next) setSettingsTeam(null);
        }}
      />
    </div>
  );
}
