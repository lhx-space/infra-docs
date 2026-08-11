import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandList
} from '@/components/ui/command';

interface SearchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * 全局搜索弹窗骨架：当前不接真实数据（无 mock），仅搭好弹窗交互框架。
 * 默认展示"最近文档"分组与关键字搜索输入框，真实数据接入见 tasks.md 后续迭代部分。
 */
export function SearchDialog({open, onOpenChange}: SearchDialogProps) {
  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="搜索文档"
      description="输入关键字搜索文档，或直接选择最近文档"
    >
      <CommandInput placeholder="搜索文档..." />
      <CommandList>
        <CommandEmpty>暂无匹配结果</CommandEmpty>
        <CommandGroup heading="最近文档">
          {/* TODO: 接入真实文档数据后在此渲染最近文档列表 */}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
