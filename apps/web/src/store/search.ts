import type {SearchResult} from '@/services/search';
import * as searchService from '@/services/search';

export type {SearchResult};

/**
 * 搜索本身没有需要跨组件共享的持久状态（结果只在 `SearchDialog` 打开期间短暂使用），
 * 这里只是把 `services/search.ts` 包一层函数导出，遵循"组件不直接 import services"的
 * 统一约束（跟 `store/wiki.ts`/`store/document.ts` 里那些"薄转发" action 是同一个模式，
 * 只是没有 zustand 状态需要维护，不需要 `create()`）。
 */
export function search(keyword: string): Promise<SearchResult> {
  return searchService.search(keyword);
}
