import type {Document, Wiki} from '../generated/prisma/client';
import {listWikisByUserId, searchWikisByIds} from '../models/wiki';
import {searchDocuments} from './document';

export interface SearchResult {
  wikis: Wiki[];
  documents: Document[];
}

/**
 * 搜索范围为当前用户可访问的全部 Wiki 与 Document，不受当前团队上下文筛选
 * （见 wiki-search spec.md「搜索范围为全部可访问 Wiki 与文档，不受当前团队筛选」）。
 * `listWikisByUserId` 已经是"当前用户是成员的全部工作区"，天然跨团队，不需要额外处理。
 */
export async function search(userId: string, keyword: string): Promise<SearchResult> {
  const trimmed = keyword.trim();
  const accessibleWikis = await listWikisByUserId(userId);
  const wikiIds = accessibleWikis.map(wiki => wiki.id);

  if (wikiIds.length === 0 || !trimmed) {
    return {wikis: [], documents: []};
  }

  const [wikis, documents] = await Promise.all([
    searchWikisByIds(wikiIds, trimmed),
    searchDocuments(wikiIds, trimmed)
  ]);

  return {wikis, documents};
}
