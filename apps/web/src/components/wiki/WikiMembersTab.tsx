import {Loader2, Trash2, UserPlus} from 'lucide-react';
import {type SubmitEvent, useEffect, useState} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {ApiError} from '@/network';
import type {Wiki, WikiMember, WikiRole} from '@/store/wiki';
import {useWikiStore} from '@/store/wiki';

interface WikiMembersTabProps {
  wiki: Wiki;
  canManage: boolean;
}

const ROLE_OPTIONS: WikiRole[] = ['OWNER', 'EDITOR', 'VIEWER'];

const SELECT_CLASS =
  'h-8 rounded-md border border-input bg-transparent px-2 text-xs outline-none disabled:opacity-50';

/**
 * Members Tab：成员列表 + 仅 OWNER 可见的"查找并添加成员/改角色/移除"操作（分享权限管控，见 spec.md）。
 * canManage 为 false（EDITOR/VIEWER）时只展示只读的成员+角色列表，不展示任何管理入口。
 */
export function WikiMembersTab({wiki, canManage}: WikiMembersTabProps) {
  const listMembers = useWikiStore(state => state.listMembers);
  const addMember = useWikiStore(state => state.addMember);
  const updateMemberRole = useWikiStore(state => state.updateMemberRole);
  const removeMember = useWikiStore(state => state.removeMember);
  const lookupUser = useWikiStore(state => state.lookupUser);

  const [members, setMembers] = useState<WikiMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [identifier, setIdentifier] = useState('');
  const [newRole, setNewRole] = useState<WikiRole>('VIEWER');
  const [addSubmitting, setAddSubmitting] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const [pendingUserId, setPendingUserId] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    listMembers(wiki.id)
      .then(setMembers)
      .catch(() => setError('成员列表加载失败'))
      .finally(() => setLoading(false));
  }, [wiki.id, listMembers]);

  /** lookupUser 找到后再 addMember；找不到直接提示，不发起添加请求（见 spec.md「查找不到用户时的提示」） */
  async function handleAddMember(e: SubmitEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    if (!identifier.trim()) return;

    setAddSubmitting(true);
    setAddError(null);
    try {
      const found = await lookupUser(identifier.trim());
      const member = await addMember(wiki.id, found.id, newRole);
      setMembers(prev => [...prev, {...member, user: {id: found.id, username: found.username}}]);
      setIdentifier('');
      setNewRole('VIEWER');
    } catch (err) {
      if (err instanceof ApiError && err.message === 'user_not_found') {
        setAddError('用户不存在');
      } else if (err instanceof ApiError && err.message === 'already_member') {
        setAddError('该用户已是成员');
      } else {
        setAddError('添加失败，请稍后重试');
      }
    } finally {
      setAddSubmitting(false);
    }
  }

  async function handleRoleChange(userId: string, role: WikiRole): Promise<void> {
    setPendingUserId(userId);
    setError(null);
    try {
      const updated = await updateMemberRole(wiki.id, userId, role);
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
      await removeMember(wiki.id, userId);
      setMembers(prev => prev.filter(m => m.userId !== userId));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '移除失败，请稍后重试');
    } finally {
      setPendingUserId(null);
    }
  }

  return (
    <div className="flex flex-col gap-4 py-2">
      {canManage ? (
        <form onSubmit={handleAddMember} className="flex flex-col gap-2 rounded-md border p-3">
          <p className="text-sm font-medium">查找并添加成员</p>
          <div className="flex gap-2">
            <Input
              value={identifier}
              onChange={e => setIdentifier(e.target.value)}
              placeholder="用户名或邮箱"
              className="flex-1"
            />
            <select
              value={newRole}
              onChange={e => setNewRole(e.target.value as WikiRole)}
              className={SELECT_CLASS}
            >
              {ROLE_OPTIONS.map(role => (
                <option key={role} value={role}>
                  {role}
                </option>
              ))}
            </select>
            <Button type="submit" size="icon-sm" disabled={addSubmitting || !identifier.trim()}>
              {addSubmitting ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <UserPlus className="size-4" />
              )}
            </Button>
          </div>
          {addError ? <p className="text-sm text-destructive">{addError}</p> : null}
        </form>
      ) : null}

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {loading ? (
        <p className="py-4 text-center text-sm text-muted-foreground">加载中...</p>
      ) : (
        <div className="flex flex-col divide-y rounded-md border">
          {members.map(member => (
            <div key={member.id} className="flex items-center justify-between gap-2 px-3 py-2">
              <span className="truncate text-sm">{member.user?.username ?? member.userId}</span>
              <div className="flex items-center gap-2">
                {canManage ? (
                  <select
                    value={member.role}
                    disabled={pendingUserId === member.userId}
                    onChange={e => void handleRoleChange(member.userId, e.target.value as WikiRole)}
                    className={SELECT_CLASS}
                  >
                    {ROLE_OPTIONS.map(role => (
                      <option key={role} value={role}>
                        {role}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="text-xs text-muted-foreground">{member.role}</span>
                )}
                {canManage ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label="移除成员"
                    disabled={pendingUserId === member.userId}
                    onClick={() => void handleRemove(member.userId)}
                  >
                    <Trash2 className="size-3.5 text-destructive" />
                  </Button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
