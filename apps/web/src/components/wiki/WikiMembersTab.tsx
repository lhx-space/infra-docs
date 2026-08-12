import {Check, Copy, Loader2, Trash2, UserPlus, X} from 'lucide-react';
import {useEffect, useState} from 'react';
import {toast} from 'sonner';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import {ApiError} from '@/network';
import type {TeamMember} from '@/store/team';
import {useTeamStore} from '@/store/team';
import type {Wiki, WikiJoinRequest, WikiMember, WikiRole, WikiShareLink} from '@/store/wiki';
import {useWikiStore} from '@/store/wiki';

interface WikiMembersTabProps {
  wiki: Wiki;
  canManage: boolean;
  /** OWNER/EDITOR 都能生成分享链接，角色上限跟随这个值动态收窄（见 spec.md「工作区分享链接」） */
  currentRole: WikiRole;
}

const ROLE_OPTIONS: WikiRole[] = ['OWNER', 'EDITOR', 'VIEWER'];

const SELECT_CLASS =
  'h-8 rounded-md border border-input bg-transparent px-2 text-xs outline-none disabled:opacity-50';

/** 分享链接授予的角色不能超过当前用户自己的角色（见 design.md 决策 8），本地先做一层收窄，
 * 真正的校验在后端，避免误以为"前端隐藏了就等于安全" */
function shareableRoles(currentRole: WikiRole): WikiRole[] {
  if (currentRole === 'OWNER') return ROLE_OPTIONS;
  if (currentRole === 'EDITOR') return ['EDITOR', 'VIEWER'];
  return ['VIEWER'];
}

/**
 * Members Tab：成员列表 + 仅 OWNER 可见的"从团队成员列表勾选添加/改角色/移除"操作
 * （不再支持精确查找任意已注册用户，见 team-workspace-model spec.md「工作区成员管理」）；
 * 额外包含分享链接生成（OWNER/EDITOR）与待审批申请列表（仅 OWNER）。
 * canManage 为 false（EDITOR/VIEWER）时只展示只读的成员+角色列表，不展示任何管理入口。
 */
export function WikiMembersTab({wiki, canManage, currentRole}: WikiMembersTabProps) {
  const listMembers = useWikiStore(state => state.listMembers);
  const addMember = useWikiStore(state => state.addMember);
  const updateMemberRole = useWikiStore(state => state.updateMemberRole);
  const removeMember = useWikiStore(state => state.removeMember);
  const createShareLink = useWikiStore(state => state.createShareLink);
  const listPendingJoinRequests = useWikiStore(state => state.listPendingJoinRequests);
  const reviewJoinRequest = useWikiStore(state => state.reviewJoinRequest);
  const listTeamMembers = useTeamStore(state => state.listMembers);

  const [members, setMembers] = useState<WikiMember[]>([]);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedUserId, setSelectedUserId] = useState('');
  const [newRole, setNewRole] = useState<WikiRole>('VIEWER');
  const [addSubmitting, setAddSubmitting] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const [pendingUserId, setPendingUserId] = useState<string | null>(null);

  const [shareRole, setShareRole] = useState<WikiRole>('VIEWER');
  const [shareLink, setShareLink] = useState<WikiShareLink | null>(null);
  const [shareGenerating, setShareGenerating] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const [joinRequests, setJoinRequests] = useState<WikiJoinRequest[]>([]);
  const [reviewingId, setReviewingId] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      listMembers(wiki.id),
      canManage ? listTeamMembers(wiki.teamId) : Promise.resolve([]),
      canManage ? listPendingJoinRequests(wiki.id) : Promise.resolve([])
    ])
      .then(([memberList, teamMemberList, requests]) => {
        setMembers(memberList);
        setTeamMembers(teamMemberList);
        setJoinRequests(requests);
      })
      .catch(() => setError('成员列表加载失败'))
      .finally(() => setLoading(false));
  }, [wiki.id, wiki.teamId, canManage, listMembers, listTeamMembers, listPendingJoinRequests]);

  // 只能从"已经是同 Team 成员、但尚未是这个 Wiki 成员"的人里选（见 spec.md「工作区成员管理」）
  const addableTeamMembers = teamMembers.filter(tm => !members.some(m => m.userId === tm.userId));

  async function handleAddMember(): Promise<void> {
    if (!selectedUserId) return;
    setAddSubmitting(true);
    setAddError(null);
    try {
      const member = await addMember(wiki.id, selectedUserId, newRole);
      const teamMember = teamMembers.find(tm => tm.userId === selectedUserId);
      setMembers(prev => [...prev, {...member, user: teamMember?.user}]);
      setSelectedUserId('');
      setNewRole('VIEWER');
    } catch (err) {
      if (err instanceof ApiError && err.message === 'already_member') {
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
      toast.success('已移除成员');
    } catch (err) {
      const message = err instanceof ApiError ? err.message : '移除失败，请稍后重试';
      setError(message);
      toast.error(message);
    } finally {
      setPendingUserId(null);
    }
  }

  function shareUrl(token: string): string {
    return `${window.location.origin}/share-links/${token}`;
  }

  async function handleGenerateShareLink(): Promise<void> {
    setShareGenerating(true);
    setShareError(null);
    try {
      const link = await createShareLink(wiki.id, shareRole);
      setShareLink(link);
      setCopied(false);
    } catch (err) {
      setShareError(err instanceof ApiError ? err.message : '生成失败，请稍后重试');
    } finally {
      setShareGenerating(false);
    }
  }

  async function handleCopyShareLink(): Promise<void> {
    if (!shareLink) return;
    await navigator.clipboard.writeText(shareUrl(shareLink.token));
    setCopied(true);
  }

  async function handleReviewRequest(requestId: string, approve: boolean): Promise<void> {
    setReviewingId(requestId);
    setError(null);
    try {
      await reviewJoinRequest(wiki.id, requestId, approve);
      setJoinRequests(prev => prev.filter(r => r.id !== requestId));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '操作失败，请稍后重试');
    } finally {
      setReviewingId(null);
    }
  }

  return (
    <div className="flex flex-col gap-4 py-2">
      {canManage && joinRequests.length > 0 ? (
        <div className="flex flex-col gap-2 rounded-md border p-3">
          <p className="text-sm font-medium">待审批申请</p>
          <div className="flex flex-col divide-y">
            {joinRequests.map(request => (
              <div key={request.id} className="flex items-center justify-between gap-2 py-1.5">
                <span className="truncate text-sm">{request.user?.username ?? request.userId}</span>
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label="批准"
                    disabled={reviewingId === request.id}
                    onClick={() => void handleReviewRequest(request.id, true)}
                  >
                    <Check className="size-3.5 text-primary" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label="拒绝"
                    disabled={reviewingId === request.id}
                    onClick={() => void handleReviewRequest(request.id, false)}
                  >
                    <X className="size-3.5 text-destructive" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {canManage ? (
        <div className="flex flex-col gap-2 rounded-md border p-3">
          <p className="text-sm font-medium">从团队成员中添加</p>
          <div className="flex gap-2">
            <select
              value={selectedUserId}
              onChange={e => setSelectedUserId(e.target.value)}
              className={`flex-1 ${SELECT_CLASS}`}
            >
              <option value="">选择团队成员...</option>
              {addableTeamMembers.map(tm => (
                <option key={tm.userId} value={tm.userId}>
                  {tm.user?.username ?? tm.userId}
                </option>
              ))}
            </select>
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
            <Button
              type="button"
              size="icon-sm"
              disabled={addSubmitting || !selectedUserId}
              onClick={() => void handleAddMember()}
            >
              {addSubmitting ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <UserPlus className="size-4" />
              )}
            </Button>
          </div>
          {addableTeamMembers.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              团队内暂无可添加的成员，可先邀请对方加入团队
            </p>
          ) : null}
          {addError ? <p className="text-sm text-destructive">{addError}</p> : null}
        </div>
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

      <div className="flex flex-col gap-2 rounded-md border p-3">
        <p className="text-sm font-medium">分享链接</p>
        <p className="text-xs text-muted-foreground">
          只对同团队成员生效，授予的角色不能超过你自己当前的角色
        </p>
        <div className="flex gap-2">
          <select
            value={shareRole}
            onChange={e => setShareRole(e.target.value as WikiRole)}
            className={SELECT_CLASS}
          >
            {shareableRoles(currentRole).map(role => (
              <option key={role} value={role}>
                {role}
              </option>
            ))}
          </select>
          <Button
            type="button"
            size="sm"
            disabled={shareGenerating}
            onClick={() => void handleGenerateShareLink()}
          >
            {shareGenerating ? <Loader2 className="size-4 animate-spin" /> : null}
            生成链接
          </Button>
        </div>
        {shareLink ? (
          <div className="flex flex-col gap-1">
            <Label className="text-xs">链接</Label>
            <div className="flex gap-2">
              <Input readOnly value={shareUrl(shareLink.token)} className="flex-1 text-xs" />
              <Button
                type="button"
                variant="outline"
                size="icon-sm"
                onClick={() => void handleCopyShareLink()}
              >
                <Copy className="size-3.5" />
              </Button>
            </div>
            {copied ? <p className="text-xs text-muted-foreground">已复制</p> : null}
          </div>
        ) : null}
        {shareError ? <p className="text-sm text-destructive">{shareError}</p> : null}
      </div>
    </div>
  );
}
