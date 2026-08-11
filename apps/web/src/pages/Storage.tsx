import {EmptyState} from '@/components/shared/EmptyState';
import {PageHeader} from '@/components/shell/PageHeaderContext';

export default function Storage() {
  return (
    <>
      <PageHeader title="Manage Storage" />
      <EmptyState title="暂无文档" description="这里会展示你所有的文档，支持筛选、排序与批量管理" />
    </>
  );
}
