import type {RouteMeta} from './types';

interface RouterLike {
  state: {matches: unknown[]};
  subscribe: (listener: () => void) => () => void;
}

const DEFAULT_TITLE = 'Yjs Docs';

/** 根据当前匹配路由链中最深一层带 title 的 meta 同步 document.title，路由切换时自动更新 */
export function syncDocumentTitle(router: RouterLike): void {
  const applyTitle = () => {
    const matches = router.state.matches;
    let title: string | undefined;

    for (let i = matches.length - 1; i >= 0; i -= 1) {
      const match = matches[i] as {handle?: unknown} | undefined;
      const meta = match?.handle as RouteMeta | undefined;
      if (meta?.title) {
        title = meta.title;
        break;
      }
    }

    document.title = title ? `${title} · ${DEFAULT_TITLE}` : DEFAULT_TITLE;
  };

  applyTitle();
  router.subscribe(applyTitle);
}
