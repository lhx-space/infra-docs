import {ApiError} from '@luhanxin/api-client';
import type {Team, TeamMember, TeamRole} from '@luhanxin/core';
import {formatDateTime, useAuthStore, useTeamStore} from '@luhanxin/core';
import {Button, DataTable, type DataTableColumn} from '@luhanxin/ui';
import {Trash2} from 'lucide-react';
import {useEffect, useState} from 'react';
import {toast} from 'sonner';

interface TeamMembersTabProps {
  team: Team;
  canManage: boolean;
}

const ROLE_OPTIONS: TeamRole[] = ['OWNER', 'MEMBER'];

const SELECT_CLASS =
  'h-8 rounded-md border border-input bg-transparent px-2 text-xs outline-none disabled:opacity-50';

/**
 * 成员列表：OWNER 能改角色/移除成员；任何成员（含 OWNER，只要不是最后一个）都能对自己
 * 执行同一个"移除"操作来退出团队（见 spec.md「团队至少保留一个 OWNER」「退出团队时的
 * 工作区所有权转移」，具体转移逻辑在后端完成，这里只负责触发）。
 */
export function TeamMembersTab({team, canManage}: TeamMembersTabProps) {
  const currentUserId = useAuthStore(state => state.user?.id);
  const listMembers = useTeamStore(state => state.listMembers);
  const updateMemberRole = useTeamStore(state => state.updateMemberRole);
  const removeMember = useTeamStore(state => state.removeMember);

  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingUserId, setPendingUserId] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    listMembers(team.id)
      .then(setMembers)
      .catch(() => setError('成员列表加载失败'))
      .finally(() => setLoading(false));
  }, [team.id, listMembers]);

  async function handleRoleChange(userId: string, role: TeamRole): Promise<void> {
    setPendingUserId(userId);
    setError(null);
    try {
      const updated = await updateMemberRole(team.id, userId, role);
      setMembers(prev => prev.map(m => (m.userId === userId ? {...m, role: updated.role} : m)));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '修改角色失败，请稍后重试');
    } finally {
      setPendingUserId(null);
    }
  }

  async function handleRemove(userId: string): Promise<void> {
    setPendingUserId(userId);
    setError(null);
    try {
      await removeMember(team.id, userId);
      setMembers(prev => prev.filter(m => m.userId !== userId));
      toast.success('已移除成员');
    } catch (err) {
      const message = err instanceof ApiError ? err.message : '操作失败，请稍后重试';
      setError(message);
      toast.error(message);
    } finally {
      setPendingUserId(null);
    }
  }

  const columns: Array<DataTableColumn<TeamMember>> = [
    {
      key: 'user',
      header: '成员',
      render: member => {
        const isSelf = member.userId === currentUserId;
        return (
          <span className="font-medium">
            {member.user?.username ?? member.userId}
            {isSelf ? <span className="ml-1 text-xs text-muted-foreground">(我)</span> : null}
          </span>
        );
      }
    },
    {
      key: 'role',
      header: '角色',
      render: member =>
        canManage ? (
          <select
            value={member.role}
            disabled={pendingUserId === member.userId}
            onChange={e => void handleRoleChange(member.userId, e.target.value as TeamRole)}
            className={SELECT_CLASS}
          >
            {ROLE_OPTIONS.map(role => (
              <option key={role} value={role}>
                {role}
              </option>
            ))}
          </select>
        ) : (
          <span className="text-muted-foreground">{member.role}</span>
        )
    },
    {
      key: 'createdAt',
      header: '加入时间',
      render: member => (
        <span className="text-muted-foreground">{formatDateTime(member.createdAt)}</span>
      )
    },
    {
      key: 'actions',
      header: '',
      className: 'w-12 text-right',
      render: member => {
        const isSelf = member.userId === currentUserId;
        if (!canManage && !isSelf) return null;
        return (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={isSelf ? '退出团队' : '移除成员'}
            disabled={pendingUserId === member.userId}
            onClick={() => void handleRemove(member.userId)}
          >
            <Trash2 className="size-3.5 text-destructive" />
          </Button>
        );
      }
    }
  ];

  return (
    <div className="flex flex-col gap-4 py-2">
      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <DataTable columns={columns} rows={members} rowKey={member => member.id} loading={loading} />
    </div>
  );
}
