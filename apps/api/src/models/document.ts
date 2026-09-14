import {prisma} from '../db/prisma';
import type {Document, Prisma, PrismaClient} from '../generated/prisma/client';

export type {Document};

/** 允许调用方传入事务客户端（tx），保证跨多次查询/写入的原子性；不传时默认走全局单例 */
type Client = PrismaClient | Prisma.TransactionClient;

export interface CreateDocumentInput {
  wikiId: string;
  parentId?: string | null;
  title?: string;
  content?: Prisma.InputJsonValue;
  coverImage?: string;
  order?: number;
}

export function createDocument(
  input: CreateDocumentInput,
  client: Client = prisma
): Promise<Document> {
  return client.document.create({data: input});
}

export function findDocumentById(id: string, client: Client = prisma): Promise<Document | null> {
  return client.document.findUnique({where: {id}});
}

/** 一个 Wiki 下的全部文档，按同级排序字段升序返回；前端自行按 parentId 组装成树（见 design.md 决策 1） */
export function listDocumentsByWikiId(
  wikiId: string,
  client: Client = prisma
): Promise<Document[]> {
  return client.document.findMany({
    where: {wikiId},
    orderBy: [{order: 'asc'}, {createdAt: 'asc'}]
  });
}

/** 移动/重新排序时校验目标父文档归属，以及重排时枚举同级兄弟节点 */
export function listSiblingDocuments(
  wikiId: string,
  parentId: string | null,
  client: Client = prisma
): Promise<Document[]> {
  return client.document.findMany({
    where: {wikiId, parentId},
    orderBy: [{order: 'asc'}, {createdAt: 'asc'}]
  });
}

export interface UpdateDocumentInput {
  title?: string;
  content?: Prisma.InputJsonValue;
  searchText?: string;
  coverImage?: string;
  parentId?: string | null;
  order?: number;
}

export function updateDocument(
  id: string,
  data: UpdateDocumentInput,
  client: Client = prisma
): Promise<Document> {
  return client.document.update({where: {id}, data});
}

/** 同级重排：全量重新赋值受影响文档的 order（见 design.md 决策 1「order 用简单整数、同级重排序时全量重新赋值」） */
export function reorderDocuments(
  updates: Array<{id: string; order: number}>,
  client: Client = prisma
): Promise<Document[]> {
  return Promise.all(
    updates.map(({id, order}) => client.document.update({where: {id}, data: {order}}))
  );
}

/** 子文档与版本历史通过 schema 的 onDelete: Cascade 自动级联删除，不需要在这里手动清理 */
export function deleteDocument(id: string, client: Client = prisma): Promise<Document> {
  return client.document.delete({where: {id}});
}

/** 搜索接口用：`ILIKE` 匹配标题/正文纯文本，范围限定在调用方已确认可访问的 wikiId 集合内 */
export function searchDocuments(
  wikiIds: string[],
  keyword: string,
  client: Client = prisma
): Promise<Document[]> {
  return client.document.findMany({
    where: {
      wikiId: {in: wikiIds},
      OR: [
        {title: {contains: keyword, mode: 'insensitive'}},
        {searchText: {contains: keyword, mode: 'insensitive'}}
      ]
    },
    orderBy: {updatedAt: 'desc'}
  });
}

// ---- AI 服务 gRPC 数据源（见 openspec/changes/ai-assistant design.md 决策 11）----
// 下面两个函数供 `grpc/ai-data-service.ts` 使用：ai-server 通过 gRPC 拉取「内容有变的
// 文档枚举」与「全量现存文档 ID」，分别用于 RAG 增量重索引与删除对账。分页统一用
// keyset 游标（(updatedAt, id) / id），避免大 offset 深分页的性能问题。

export interface DocumentChangeRecord {
  id: string;
  wikiId: string;
  title: string;
  searchText: string;
  updatedAt: Date;
}

interface ChangeCursor {
  updatedAt: Date;
  id: string;
}

function encodeChangeCursor(cursor: ChangeCursor): string {
  return Buffer.from(
    JSON.stringify({updatedAt: cursor.updatedAt.toISOString(), id: cursor.id})
  ).toString('base64url');
}

function decodeChangeCursor(token: string): ChangeCursor | null {
  if (!token) return null;
  try {
    const parsed = JSON.parse(Buffer.from(token, 'base64url').toString('utf8')) as {
      updatedAt: string;
      id: string;
    };
    const updatedAt = new Date(parsed.updatedAt);
    if (Number.isNaN(updatedAt.getTime())) return null;
    return {updatedAt, id: parsed.id};
  } catch {
    return null;
  }
}

export interface PagedDocumentsChangedSince {
  documents: DocumentChangeRecord[];
  nextPageToken: string;
}

/**
 * 枚举自 `watermarkIso`（RFC3339，空串 = 从最早）以来内容有变的文档，按 (updatedAt, id)
 * 升序 keyset 分页。用 `updatedAt >= watermark`（宁可重复、不可漏：重复处理对 ai-server
 * 的 upsert 幂等无害，见 design.md 决策 11）。
 */
export async function listDocumentsChangedSince(
  watermarkIso: string,
  pageSize: number,
  pageToken: string
): Promise<PagedDocumentsChangedSince> {
  const parsed = watermarkIso ? new Date(watermarkIso) : new Date(0);
  const watermark = Number.isNaN(parsed.getTime()) ? new Date(0) : parsed;
  const cursor = decodeChangeCursor(pageToken);
  const limit = Math.max(1, Math.min(pageSize || 50, 100));

  const where = cursor
    ? {
        AND: [
          {updatedAt: {gte: watermark}},
          {
            OR: [
              {updatedAt: {gt: cursor.updatedAt}},
              {updatedAt: cursor.updatedAt, id: {gt: cursor.id}}
            ]
          }
        ]
      }
    : {updatedAt: {gte: watermark}};

  const rows = await prisma.document.findMany({
    where,
    orderBy: [{updatedAt: 'asc'}, {id: 'asc'}],
    take: limit + 1,
    select: {id: true, wikiId: true, title: true, searchText: true, updatedAt: true}
  });

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];
  const nextPageToken = hasMore && last ? encodeChangeCursor(last) : '';

  return {
    documents: page.map(row => ({
      id: row.id,
      wikiId: row.wikiId,
      title: row.title,
      searchText: row.searchText,
      updatedAt: row.updatedAt
    })),
    nextPageToken
  };
}

export interface PagedDocumentIds {
  ids: string[];
  nextPageToken: string;
}

/** 分页返回全部现存文档 ID（按 id 升序 keyset 分页），供 ai-server 删除对账（决策 11）。 */
export async function listAllDocumentIds(
  pageSize: number,
  pageToken: string
): Promise<PagedDocumentIds> {
  const limit = Math.max(1, Math.min(pageSize || 1000, 1000));
  const cursorId = pageToken ? Buffer.from(pageToken, 'base64url').toString('utf8') : null;

  const rows = await prisma.document.findMany({
    where: cursorId ? {id: {gt: cursorId}} : {},
    orderBy: {id: 'asc'},
    take: limit + 1,
    select: {id: true}
  });

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];
  const nextPageToken = hasMore && last ? Buffer.from(last.id).toString('base64url') : '';

  return {ids: page.map(r => r.id), nextPageToken};
}
