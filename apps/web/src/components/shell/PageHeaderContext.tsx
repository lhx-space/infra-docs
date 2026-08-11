import {createContext, type ReactNode, useContext, useEffect, useState} from 'react';

interface PageHeaderValue {
  title: ReactNode;
  actions: ReactNode;
}

const EMPTY_HEADER: PageHeaderValue = {title: null, actions: null};

interface PageHeaderContextValue {
  header: PageHeaderValue;
  setHeader: (value: PageHeaderValue) => void;
}

const PageHeaderContext = createContext<PageHeaderContextValue | null>(null);

/**
 * 只应该在 AppShell 内部使用一次：持有"当前页面标题/操作按钮"这份易变状态，
 * 并把 setter 通过 Context 暴露给子路由页面（见 PageHeader 组件）。
 * 用 Context 而不是 zustand store，是因为这份状态天然跟"当前挂载的页面"生命周期绑定，
 * 不需要跨路由持久化，也不需要在 store 里存 ReactNode 这种非序列化数据。
 */
export function usePageHeaderState(): PageHeaderContextValue {
  const [header, setHeader] = useState<PageHeaderValue>(EMPTY_HEADER);
  return {header, setHeader};
}

export function PageHeaderProvider({
  value,
  children
}: {
  value: PageHeaderContextValue;
  children: ReactNode;
}) {
  return <PageHeaderContext.Provider value={value}>{children}</PageHeaderContext.Provider>;
}

/**
 * 页面组件用这个声明自己的标题和操作按钮，内容会被 AppShell 顶部的 Header 行渲染。
 * 组件卸载（切换页面）时自动清空，不会有上一个页面的按钮残留到下一个页面。
 */
export function PageHeader({title, actions}: {title: ReactNode; actions?: ReactNode}) {
  const ctx = useContext(PageHeaderContext);
  if (!ctx) throw new Error('PageHeader 必须在 AppShell 内部使用');
  const {setHeader} = ctx;

  useEffect(() => {
    setHeader({title, actions: actions ?? null});
    return () => setHeader(EMPTY_HEADER);
    // title/actions 是页面每次渲染时新建的 ReactNode（比如按钮的 disabled 状态变化），
    // 必须放进依赖数组让它们变化时同步刷新，否则 Header 会显示过期的操作按钮状态。
  }, [title, actions, setHeader]);

  return null;
}

export function usePageHeaderContext(): PageHeaderContextValue {
  const ctx = useContext(PageHeaderContext);
  if (!ctx) throw new Error('usePageHeaderContext 必须在 AppShell 内部使用');
  return ctx;
}
