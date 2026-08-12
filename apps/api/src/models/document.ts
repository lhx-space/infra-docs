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
