import type * as React from 'react';

import {cn} from '@/lib/utils';

/**
 * 表格基础件（shadcn 风格）：只提供无样式的语义结构 + 少量排版/边框样式，
 * 列定义、行点击、loading/空态等业务能力由 `components/shared/DataTable.tsx` 在上层统一封装，
 * 这里保持与 `button`/`card` 等 ui 基础件一致的最小职责。
 */
function Table({className, ...props}: React.ComponentProps<'table'>) {
  return (
    <div data-slot="table-container" className="relative w-full overflow-x-auto">
      <table
        data-slot="table"
        className={cn('w-full caption-bottom text-sm', className)}
        {...props}
      />
    </div>
  );
}

function TableHeader({className, ...props}: React.ComponentProps<'thead'>) {
  return <thead data-slot="table-header" className={cn('[&_tr]:border-b', className)} {...props} />;
}

function TableBody({className, ...props}: React.ComponentProps<'tbody'>) {
  return (
    <tbody
      data-slot="table-body"
      className={cn('[&_tr:last-child]:border-0', className)}
      {...props}
    />
  );
}

function TableRow({className, ...props}: React.ComponentProps<'tr'>) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        'border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted',
        className
      )}
      {...props}
    />
  );
}

function TableHead({className, ...props}: React.ComponentProps<'th'>) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        'h-10 px-3 text-left align-middle text-xs font-medium text-muted-foreground whitespace-nowrap',
        className
      )}
      {...props}
    />
  );
}

function TableCell({className, ...props}: React.ComponentProps<'td'>) {
  return (
    <td
      data-slot="table-cell"
      className={cn('px-3 py-2.5 align-middle whitespace-nowrap', className)}
      {...props}
    />
  );
}

export {Table, TableBody, TableCell, TableHead, TableHeader, TableRow};
