import {Inbox} from 'lucide-react';
import type {ComponentType, ReactNode} from 'react';
import {cn} from '@/lib/utils';

interface EmptyStateProps {
  icon?: ComponentType<{className?: string}>;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

/**
 * 通用空内容占位组件：不依赖任何数据，供页面 Content 区域在没有内容时展示，
 * 逻辑上类似路由未匹配时展示 404——没有内容就展示空态，而不是造一批假数据。
 * 后续也可复用在"筛选无结果"、"列表为空"等场景。
 */
export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
  className
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-1 flex-col items-center justify-center gap-3 p-10 text-center',
        className
      )}
    >
      <div className="flex size-12 items-center justify-center rounded-full bg-muted">
        <Icon className="size-6 text-muted-foreground" />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium">{title}</p>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {action ? <div className="pt-2">{action}</div> : null}
    </div>
  );
}
