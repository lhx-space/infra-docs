import {Loader2} from 'lucide-react';
import {type SubmitEvent, useState} from 'react';
import {toast} from 'sonner';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import {ApiError} from '@/network';
import type {Team} from '@/store/team';
import {useTeamStore} from '@/store/team';

interface TeamBasicInfoTabProps {
  team: Team;
  canEdit: boolean;
  canDelete: boolean;
  onDeleted: () => void;
}

/**
 * 团队基本信息：改名 + 删除团队（仅 OWNER）。个人 Team（`isPersonal`）不展示删除区域，
 * 后端也会拒绝这个操作（见 spec.md「个人 Team 禁止删除与离开」「删除团队」）。
 */
export function TeamBasicInfoTab({team, canEdit, canDelete, onDeleted}: TeamBasicInfoTabProps) {
  const updateTeamName = useTeamStore(state => state.updateTeamName);
  const deleteTeam = useTeamStore(state => state.deleteTeam);

  const [name, setName] = useState(team.name);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleSubmit(e: SubmitEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    if (!canEdit || !name.trim()) return;

    setSubmitting(true);
    setError(null);
    try {
      await updateTeamName(team.id, name.trim());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '保存失败，请稍后重试');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(): Promise<void> {
    setDeleting(true);
    setError(null);
    try {
      await deleteTeam(team.id);
      toast.success('团队已删除');
      onDeleted();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : '删除失败，请稍后重试';
      setError(message);
      toast.error(message);
      setConfirmingDelete(false);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 py-2">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="team-settings-name">团队名称</Label>
          <Input
            id="team-settings-name"
            value={name}
            onChange={e => setName(e.target.value)}
            maxLength={100}
            disabled={!canEdit}
            required
          />
        </div>

        {error ? <p className="text-sm text-destructive">{error}</p> : null}

        {canEdit ? (
          <Button type="submit" disabled={submitting || !name.trim()} className="self-end">
            {submitting ? <Loader2 className="size-4 animate-spin" /> : null}
            保存
          </Button>
        ) : null}
      </form>

      {team.isPersonal ? (
        <p className="text-xs text-muted-foreground">这是你的个人空间，不能被删除或退出</p>
      ) : canDelete ? (
        <div className="mt-2 flex flex-col gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3">
          <p className="text-sm font-medium text-destructive">删除团队</p>
          <p className="text-xs text-muted-foreground">
            删除后无法恢复，团队下所有 Wiki 及成员关系都会一并删除
          </p>
          {confirmingDelete ? (
            <div className="flex gap-2">
              <Button
                type="button"
                variant="destructive"
                size="sm"
                disabled={deleting}
                onClick={() => void handleDelete()}
              >
                {deleting ? <Loader2 className="size-4 animate-spin" /> : null}
                确认删除
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={deleting}
                onClick={() => setConfirmingDelete(false)}
              >
                取消
              </Button>
            </div>
          ) : (
            <Button
              type="button"
              variant="destructive"
              size="sm"
              className="self-start"
              onClick={() => setConfirmingDelete(true)}
            >
              删除团队
            </Button>
          )}
        </div>
      ) : null}
    </div>
  );
}
