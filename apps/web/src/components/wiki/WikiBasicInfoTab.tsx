import {Loader2} from 'lucide-react';
import {type ChangeEvent, type SubmitEvent, useRef, useState} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import {ApiError} from '@/network';
import type {Wiki} from '@/store/wiki';
import {useWikiStore} from '@/store/wiki';

interface WikiBasicInfoTabProps {
  wiki: Wiki;
  canEdit: boolean;
  canDelete: boolean;
  onDeleted: () => void;
}

/**
 * Basic Information：改名/改简介/换封面图 + 删除工作区（仅 OWNER）。
 * canEdit 为 false（VIEWER）时所有编辑控件禁用；canDelete 为 false（EDITOR）时不展示删除区域
 * （见 spec.md「设置面板 - Basic Information 管理」，这只是体验层校验，真正边界在后端）。
 */
export function WikiBasicInfoTab({wiki, canEdit, canDelete, onDeleted}: WikiBasicInfoTabProps) {
  const updateWikiInfo = useWikiStore(state => state.updateWikiInfo);
  const deleteWiki = useWikiStore(state => state.deleteWiki);
  const uploadCoverImage = useWikiStore(state => state.uploadCoverImage);

  const [name, setName] = useState(wiki.name);
  const [description, setDescription] = useState(wiki.description ?? '');
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverPreview, setCoverPreview] = useState<string | null>(wiki.coverImage);
  const [allowJoinRequest, setAllowJoinRequest] = useState(wiki.allowJoinRequest);
  const [joinRequestSaving, setJoinRequestSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // canDelete 在 WikiSettingsDialog 里就是 role === 'OWNER'，跟"能开关申请加入"是同一批人，
  // 直接复用，不新增一个 canManageJoinRequest prop
  const canToggleJoinRequest = canDelete;

  async function handleToggleJoinRequest(next: boolean): Promise<void> {
    setJoinRequestSaving(true);
    setError(null);
    try {
      await updateWikiInfo(wiki.id, {allowJoinRequest: next});
      setAllowJoinRequest(next);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '保存失败，请稍后重试');
    } finally {
      setJoinRequestSaving(false);
    }
  }

  function handleFileChange(e: ChangeEvent<HTMLInputElement>): void {
    const file = e.target.files?.[0];
    if (!file) return;
    setCoverFile(file);
    setCoverPreview(URL.createObjectURL(file));
  }

  async function handleSubmit(e: SubmitEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    if (!canEdit || !name.trim()) return;

    setSubmitting(true);
    setError(null);
    try {
      const coverImage = coverFile ? await uploadCoverImage(coverFile) : undefined;
      await updateWikiInfo(wiki.id, {
        name: name.trim(),
        description: description.trim(),
        ...(coverImage ? {coverImage} : {})
      });
      setCoverFile(null);
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
      await deleteWiki(wiki.id);
      onDeleted();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '删除失败，请稍后重试');
      setConfirmingDelete(false);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 py-2">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="settings-name">名称</Label>
          <Input
            id="settings-name"
            value={name}
            onChange={e => setName(e.target.value)}
            maxLength={100}
            disabled={!canEdit}
            required
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="settings-description">简介</Label>
          <textarea
            id="settings-description"
            value={description}
            onChange={e => setDescription(e.target.value)}
            maxLength={500}
            rows={3}
            disabled={!canEdit}
            placeholder="简单描述一下这个工作区"
            className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none disabled:cursor-not-allowed disabled:opacity-50 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label>封面图</Label>
          <button
            type="button"
            disabled={!canEdit}
            onClick={() => fileInputRef.current?.click()}
            className="flex h-32 w-full items-center justify-center overflow-hidden rounded-md border border-dashed bg-muted/40 hover:bg-muted/60 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {coverPreview ? (
              <img src={coverPreview} alt="封面预览" className="size-full object-cover" />
            ) : (
              <span className="text-xs text-muted-foreground">点击上传封面图</span>
            )}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleFileChange}
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

      {canToggleJoinRequest ? (
        <div className="flex items-center justify-between gap-2 rounded-md border p-3">
          <div>
            <p className="text-sm font-medium">允许团队成员申请加入</p>
            <p className="text-xs text-muted-foreground">
              开启后，同团队的成员能在团队工作区目录里看到并申请加入这个 Wiki
            </p>
          </div>
          <input
            type="checkbox"
            checked={allowJoinRequest}
            disabled={joinRequestSaving}
            onChange={e => void handleToggleJoinRequest(e.target.checked)}
            className="size-4"
          />
        </div>
      ) : null}

      {canDelete ? (
        <div className="mt-2 flex flex-col gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3">
          <p className="text-sm font-medium text-destructive">删除工作区</p>
          <p className="text-xs text-muted-foreground">
            删除后无法恢复，所有成员的访问权限也会一并移除
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
              删除工作区
            </Button>
          )}
        </div>
      ) : null}
    </div>
  );
}
