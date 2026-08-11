import {EmptyState} from '@/components/shared/EmptyState';
import {PageHeader} from '@/components/shell/PageHeaderContext';

export default function Home() {
  return (
    <>
      <PageHeader title="Home" />
      <EmptyState title="暂无内容" description="这里会展示你的最近文档与概览信息" />
    </>
  );
}
