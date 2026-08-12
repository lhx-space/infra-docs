import {ImagePlus, Loader2} from 'lucide-react';
import {type ChangeEvent, type SubmitEvent, useEffect, useRef, useState} from 'react';
import {Button} from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import {ApiError} from '@/network';
import {useProfileStore} from '@/store/profile';
import {useWikiStore} from '@/store/wiki';

interface ProfileSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * 编辑当前登录用户的资料（昵称/简介/头像）。独立 Dialog，跟 `WikiSettingsDialog`/
 * `TeamSettingsDialog` 的既有模式一致，不做 `UserMenu` 内联表单。
 *
 * 头像上传复用 `useWikiStore.uploadCoverImage`（本质是通用图片上传接口，命名沿用了
 * 最早的 Wiki 封面图场景，但接口本身不绑定 Wiki），不新开一个头像专用上传 action
 * （见 wiki-integration-gaps design.md 决策 6）。
 *
 * 提交只调用 `PATCH /me/profile`，请求体只包含 nickname/avatarUrl/bio 三个字段，
 * 不会传 gender/birthday/phone——这三个字段本来就不在这个表单里，不存在"顺手多传"的风险。
 */
export function ProfileSettingsDialog({open, onOpenChange}: ProfileSettingsDialogProps) {
  const profile = useProfileStore(state => state.profile);
  const updateProfile = useProfileStore(state => state.updateProfile);
  const uploadAvatar = useWikiStore(state => state.uploadCoverImage);

  const [nickname, setNickname] = useState('');
  const [bio, setBio] = useState('');
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 打开时用当前 profile 预填，而不是等 store 异步刷新——UserMenu 挂载时已经拉过一次 /me，
  // 打开弹窗这一刻 profile 通常已经是最新的
  useEffect(() => {
    if (open) {
      setNickname(profile?.nickname ?? '');
      setBio(profile?.bio ?? '');
      setAvatarFile(null);
      setAvatarPreview(profile?.avatarUrl ?? null);
      setError(null);
    }
  }, [open, profile]);

  function handleOpenChange(next: boolean): void {
    if (!next) setError(null);
    onOpenChange(next);
  }

  function handleFileChange(e: ChangeEvent<HTMLInputElement>): void {
    const file = e.target.files?.[0];
    if (!file) return;
    setAvatarFile(file);
    setAvatarPreview(URL.createObjectURL(file));
  }

  async function handleSubmit(e: SubmitEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const avatarUrl = avatarFile ? await uploadAvatar(avatarFile) : undefined;
      await updateProfile({
        nickname: nickname.trim(),
        bio: bio.trim(),
        ...(avatarUrl ? {avatarUrl} : {})
      });
      handleOpenChange(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '保存失败，请稍后重试');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>编辑资料</DialogTitle>
          <DialogDescription>修改昵称、简介和头像</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label>头像</Label>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex size-20 items-center justify-center overflow-hidden rounded-full border border-dashed bg-muted/40 hover:bg-muted/60"
            >
              {avatarPreview ? (
                <img src={avatarPreview} alt="头像预览" className="size-full object-cover" />
              ) : (
                <ImagePlus className="size-5 text-muted-foreground" />
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

          <div className="flex flex-col gap-2">
            <Label htmlFor="profile-nickname">昵称</Label>
            <Input
              id="profile-nickname"
              value={nickname}
              onChange={e => setNickname(e.target.value)}
              placeholder="设置一个昵称"
              maxLength={50}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="profile-bio">简介</Label>
            <textarea
              id="profile-bio"
              value={bio}
              onChange={e => setBio(e.target.value)}
              placeholder="简单介绍一下自己"
              maxLength={500}
              rows={3}
              className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            />
          </div>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
              取消
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? <Loader2 className="size-4 animate-spin" /> : null}
              保存
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
