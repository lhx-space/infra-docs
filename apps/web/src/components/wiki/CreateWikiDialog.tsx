import {ImagePlus, Loader2} from 'lucide-react';
import {type ChangeEvent, type SubmitEvent, useRef, useState} from 'react';
import {toast} from 'sonner';
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
import {useCurrentTeam} from '@/store/team';
import {useWikiStore} from '@/store/wiki';

interface CreateWikiDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * 名称必填、简介可选、封面图可选上传；不上传封面时不传 coverImage 字段，
 * 后端会用按名称生成的默认封面兜底，不阻塞创建流程（见 spec.md「创建工作区（含简介与封面图）」）。
 *
 * 归属 Team：不再提供手动选择器，直接使用 Sidebar 团队切换器当前选中的团队——用户在点
 * "新建 Wiki"之前已经通过切换器表明了"我现在在哪个团队下工作"，不需要再选一次
 * （见 team-switcher spec.md「创建工作区时选择归属团队」REMOVED Requirements）。
 */
export function CreateWikiDialog({open, onOpenChange}: CreateWikiDialogProps) {
  const createWiki = useWikiStore(state => state.createWiki);
  const uploadCoverImage = useWikiStore(state => state.uploadCoverImage);
  const currentTeam = useCurrentTeam();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverPreview, setCoverPreview] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function resetForm(): void {
    setName('');
    setDescription('');
    setCoverFile(null);
    setCoverPreview(null);
    setError(null);
  }

  function handleOpenChange(next: boolean): void {
    if (!next) resetForm();
    onOpenChange(next);
  }

  function handleFileChange(e: ChangeEvent<HTMLInputElement>): void {
    const file = e.target.files?.[0];
    if (!file) return;
    setCoverFile(file);
    setCoverPreview(URL.createObjectURL(file));
  }

  async function handleSubmit(e: SubmitEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    if (!name.trim()) return;

    setSubmitting(true);
    setError(null);
    try {
      const coverImage = coverFile ? await uploadCoverImage(coverFile) : undefined;
      await createWiki({
        name: name.trim(),
        description: description.trim() || undefined,
        coverImage,
        teamId: currentTeam?.id
      });
      handleOpenChange(false);
      toast.success('创建成功');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '创建失败，请稍后重试');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>新建 Wiki</DialogTitle>
          <DialogDescription>
            创建一个工作区来组织你的文章，将归属到「
            {currentTeam ? (currentTeam.isPersonal ? '个人空间' : currentTeam.name) : '...'}
            」（可在 Sidebar 顶部切换团队后再创建）
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="wiki-name">名称</Label>
            <Input
              id="wiki-name"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="例如：产品文档"
              maxLength={100}
              required
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="wiki-description">简介（可选）</Label>
            <textarea
              id="wiki-description"
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="简单描述一下这个工作区"
              maxLength={500}
              rows={3}
              className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label>封面图（可选）</Label>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex h-32 w-full items-center justify-center overflow-hidden rounded-md border border-dashed bg-muted/40 hover:bg-muted/60"
            >
              {coverPreview ? (
                <img src={coverPreview} alt="封面预览" className="size-full object-cover" />
              ) : (
                <span className="flex flex-col items-center gap-1 text-xs text-muted-foreground">
                  <ImagePlus className="size-5" />
                  点击上传封面图
                </span>
              )}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleFileChange}
            />
            <p className="text-xs text-muted-foreground">不上传时将使用自动生成的默认封面</p>
          </div>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
              取消
            </Button>
            <Button type="submit" disabled={submitting || !name.trim()}>
              {submitting ? <Loader2 className="size-4 animate-spin" /> : null}
              创建
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
