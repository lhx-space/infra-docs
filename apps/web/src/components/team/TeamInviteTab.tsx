import {Copy, Loader2} from 'lucide-react';
import {useState} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import {ApiError} from '@/network';
import type {Team, TeamInvite} from '@/store/team';
import {useTeamStore} from '@/store/team';

interface TeamInviteTabProps {
  team: Team;
}

/**
 * 生成邀请链接：角色固定 MEMBER（后端强制），只暴露"使用次数上限"这一个可选配置。
 * 后端目前只提供生成/兑换/失效三个接口，没有"列出全部邀请链接"的接口，所以这里只
 * 跟踪"当前面板打开期间最近一次生成的链接"，不做持久化历史列表（见 design.md 决策 5）。
 */
export function TeamInviteTab({team}: TeamInviteTabProps) {
  const createInvite = useTeamStore(state => state.createInvite);
  const revokeInvite = useTeamStore(state => state.revokeInvite);

  const [invite, setInvite] = useState<TeamInvite | null>(null);
  const [maxUses, setMaxUses] = useState('');
  const [generating, setGenerating] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function inviteUrl(token: string): string {
    return `${window.location.origin}/invites/${token}`;
  }

  async function handleGenerate(): Promise<void> {
    setGenerating(true);
    setError(null);
    try {
      const created = await createInvite(team.id, {
        maxUses: maxUses.trim() ? Number(maxUses.trim()) : undefined
      });
      setInvite(created);
      setCopied(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '生成失败，请稍后重试');
    } finally {
      setGenerating(false);
    }
  }

  async function handleRevoke(): Promise<void> {
    if (!invite) return;
    setRevoking(true);
    setError(null);
    try {
      await revokeInvite(team.id, invite.id);
      setInvite(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '失效失败，请稍后重试');
    } finally {
      setRevoking(false);
    }
  }

  async function handleCopy(): Promise<void> {
    if (!invite) return;
    await navigator.clipboard.writeText(inviteUrl(invite.token));
    setCopied(true);
  }

  return (
    <div className="flex flex-col gap-4 py-2">
      <div className="flex flex-col gap-2 rounded-md border p-3">
        <p className="text-sm font-medium">生成邀请链接</p>
        <p className="text-xs text-muted-foreground">
          任何拿到链接的人登录后都能加入团队（角色固定为普通成员），可选设置使用次数上限
        </p>
        <div className="flex gap-2">
          <Input
            value={maxUses}
            onChange={e => setMaxUses(e.target.value)}
            placeholder="使用次数上限（留空不限）"
            type="number"
            min={1}
            className="flex-1"
          />
          <Button type="button" onClick={() => void handleGenerate()} disabled={generating}>
            {generating ? <Loader2 className="size-4 animate-spin" /> : null}
            生成
          </Button>
        </div>
      </div>

      {invite ? (
        <div className="flex flex-col gap-2 rounded-md border p-3">
          <Label>邀请链接</Label>
          <div className="flex gap-2">
            <Input readOnly value={inviteUrl(invite.token)} className="flex-1" />
            <Button type="button" variant="outline" size="icon" onClick={() => void handleCopy()}>
              <Copy className="size-4" />
            </Button>
          </div>
          {copied ? <p className="text-xs text-muted-foreground">已复制到剪贴板</p> : null}
          <Button
            type="button"
            variant="destructive"
            size="sm"
            className="self-start"
            disabled={revoking}
            onClick={() => void handleRevoke()}
          >
            {revoking ? <Loader2 className="size-4 animate-spin" /> : null}
            使链接失效
          </Button>
        </div>
      ) : null}

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}
