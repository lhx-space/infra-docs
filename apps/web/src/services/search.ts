import {http} from '@/network';
import type {Document} from './document';
import type {Wiki} from './wiki';

export interface SearchResult {
  wikis: Wiki[];
  documents: Document[];
}

/** 对应 `GET /search?q=`（见 wiki-search spec.md），空关键字场景由调用方（`SearchDialog`）
 * 自行处理，不发起请求 */
export function search(keyword: string): Promise<SearchResult> {
  return http.get<SearchResult>(`/search?q=${encodeURIComponent(keyword)}`);
}
