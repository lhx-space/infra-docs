import type {ReactNode} from 'react';
import {Table, TableBody, TableCell, TableHead, TableHeader, TableRow} from '@/components/ui/table';
import {cn} from '@/lib/utils';

export interface DataTableColumn<T> {
  /** 列唯一标识，也作为 React key */
  key: string;
  header: ReactNode;
  /** 应用到整列（表头 + 单元格）的宽度/对齐类，如 `text-right`、`w-32` */
  className?: string;
  render: (row: T) => ReactNode;
}

interface DataTableProps<T> {
  columns: Array<DataTableColumn<T>>;
  rows: T[];
  rowKey: (row: T) => string;
  /** 传入后整行可点击（跳转）；行内操作按钮需自行 stopPropagation 阻止冒泡 */
  onRowClick?: (row: T) => void;
  loading?: boolean;
  /** 空态内容，缺省显示"暂无数据" */
  empty?: ReactNode;
}

/**
 * 通用数据表：把"列定义 → 渲染表头/表体/空态/loading + 行点击"这层重复逻辑收口，
 * 供 Wiki 表、文档表、成员表、团队表共用。列内容通过 `render` 由调用方决定，
 * 行点击跳转统一走 `onRowClick`（导航逻辑由调用方用 useNavigate 实现）。
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  loading = false,
  empty = '暂无数据'
}: DataTableProps<T>) {
  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            {columns.map(col => (
              <TableHead key={col.key} className={col.className}>
                {col.header}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading ? (
            <TableRow>
              <TableCell
                colSpan={columns.length}
                className="py-10 text-center text-muted-foreground"
              >
                加载中...
              </TableCell>
            </TableRow>
          ) : rows.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={columns.length}
                className="py-10 text-center text-muted-foreground"
              >
                {empty}
              </TableCell>
            </TableRow>
          ) : (
            rows.map(row => (
              <TableRow
                key={rowKey(row)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={cn(onRowClick && 'cursor-pointer')}
              >
                {columns.map(col => (
                  <TableCell key={col.key} className={col.className}>
                    {col.render(row)}
                  </TableCell>
                ))}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
