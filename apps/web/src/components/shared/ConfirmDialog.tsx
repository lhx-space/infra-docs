import {Loader2} from 'lucide-react';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog';
import {Button} from '@/components/ui/button';

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** 危险操作（删除类）默认用红色按钮；非破坏性的确认场景可以传 `false` 用默认色 */
  destructive?: boolean;
  /** 确认按钮的 loading 态：期间禁用取消/确认，避免重复提交 */
  loading?: boolean;
  onConfirm: () => void;
}

/**
 * 统一的"二次确认"弹窗，替代原生 `window.confirm()`（见 document-editor spec.md「删除前的
 * 二次确认」）。原生 `confirm()` 是浏览器同步阻塞对话框，样式完全不可控、不跟随应用的深色
 * /浅色主题——深色模式下会跳出一个系统白框，跟应用里其他弹窗（都是这套 shadcn Dialog/
 * AlertDialog 体系）视觉断层。
 *
 * 确认按钮故意不用 `AlertDialogAction`（Radix 默认点击后立刻关闭弹窗）——删除这类操作是
 * 异步的，需要在请求完成前保持弹窗打开并展示 loading 态，请求失败时也不关闭（让用户看到
 * 报错后可以重试），这些都需要调用方自己控制 `open`，所以这里用普通 `Button` 接管点击，
 * 弹窗的开关完全交给外部传入的 `open`/`onOpenChange`。
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = '确认删除',
  cancelLabel = '取消',
  destructive = true,
  loading = false,
  onConfirm
}: ConfirmDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={next => !loading && onOpenChange(next)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description ? <AlertDialogDescription>{description}</AlertDialogDescription> : null}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={loading}>{cancelLabel}</AlertDialogCancel>
          <Button
            variant={destructive ? 'destructive' : 'default'}
            disabled={loading}
            onClick={onConfirm}
          >
            {loading ? <Loader2 className="size-4 animate-spin" /> : null}
            {confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
