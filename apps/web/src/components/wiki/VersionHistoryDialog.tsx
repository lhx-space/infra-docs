import {DocumentEditor} from '@lhx-kit/tiptap-editor';
import {useEffect, useState} from 'react';
import {toast} from 'sonner';
import {Button} from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import {ApiError} from '@/network';
import type {DocumentVersion} from '@/store/document';
import {useDocumentStore} from '@/store/document';

interface VersionHistoryDialogProps {
  wikiId: string;
  documentId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 仅 OWNER 可执行恢复（见 document-versioning spec.md「版本查看与恢复的权限边界」） */
  canRestore: boolean;
  onRestored: () => void;
}

/** 只读模式下永远不会真正触发上传/保存，这两个回调纯粹是 `DocumentEditor` 的必填 props 占位 */
async function noopUploadImage(): Promise<string> {
  throw new Error('read_only_preview_does_not_upload');
}
async function noopSave(): Promise<void> {}

/**
 * 版本历史列表 + 查看某版本内容 + `OWNER` 可见的恢复按钮（见 document-versioning spec.md）。
 * "查看内容"直接复用 `DocumentEditor` 的只读渲染能力，不重新实现一套内容展示逻辑。
 */
export function VersionHistoryDialog({
  wikiId,
  documentId,
  open,
  onOpenChange,
  canRestore,
  onRestored
}: VersionHistoryDialogProps) {
  const listVersions = useDocumentStore(state => state.listVersions);
  const restoreVersion = useDocumentStore(state => state.restoreVersion);
  const [versions, setVersions] = useState<DocumentVersion[]>([]);
  const [loading, setLoading] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setPreviewId(null);
    listVersions(wikiId, documentId)
      .then(setVersions)
      .catch(err => {
        toast.error(err instanceof ApiError ? err.message : '版本历史加载失败，请稍后重试');
      })
      .finally(() => setLoading(false));
  }, [open, wikiId, documentId, listVersions]);

  async function handleRestore(versionId: string): Promise<void> {
    setRestoringId(versionId);
    try {
      await restoreVersion(wikiId, documentId, versionId);
      toast.success('已恢复到该版本');
      onRestored();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '恢复失败，请稍后重试');
    } finally {
      setRestoringId(null);
    }
  }

  const previewVersion = versions.find(v => v.id === previewId) ?? null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>版本历史</DialogTitle>
          <DialogDescription>
            按编辑会话聚合的历史快照，{canRestore ? '可恢复到任意一个版本' : '仅 OWNER 可恢复'}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <p className="text-sm text-muted-foreground">加载中...</p>
        ) : versions.length === 0 ? (
          <p className="text-sm text-muted-foreground">暂无历史版本</p>
        ) : (
          <div className="flex max-h-96 flex-col gap-2 overflow-y-auto">
            {versions.map(version => (
              <div key={version.id} className="flex flex-col gap-2 rounded-md border px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate text-sm font-medium">{version.title}</span>
                    <span className="text-xs text-muted-foreground">
                      {new Date(version.updatedAt).toLocaleString()}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setPreviewId(previewId === version.id ? null : version.id)}
                    >
                      {previewId === version.id ? '收起' : '查看'}
                    </Button>
                    {canRestore ? (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={restoringId === version.id}
                        onClick={() => void handleRestore(version.id)}
                      >
                        恢复
                      </Button>
                    ) : null}
                  </div>
                </div>
                {previewId === version.id && previewVersion ? (
                  <div className="max-h-64 overflow-y-auto rounded-md border bg-muted/30">
                    <DocumentEditor
                      key={previewVersion.id}
                      content={previewVersion.content}
                      editable={false}
                      uploadImage={noopUploadImage}
                      onSave={noopSave}
                    />
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
