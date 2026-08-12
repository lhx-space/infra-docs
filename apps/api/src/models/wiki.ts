import {prisma} from '../db/prisma';
import type {Prisma, PrismaClient, Wiki} from '../generated/prisma/client';

export type {Wiki};

/** 允许调用方传入事务客户端（tx），保证跨多次查询/写入的原子性；不传时默认走全局单例 */
type Client = PrismaClient | Prisma.TransactionClient;

export function findWikiById(id: string, client: Client = prisma): Promise<Wiki | null> {
  return client.wiki.findUnique({where: {id}});
}

/** 通过 WikiMember 反查当前用户所在的所有工作区，按工作区更新时间倒序（见 design.md 决策 3） */
export function listWikisByUserId(userId: string): Promise<Wiki[]> {
  return prisma.wiki.findMany({
    where: {members: {some: {userId}}},
    orderBy: {updatedAt: 'desc'}
  });
}

export interface UpdateWikiInfoInput {
  name?: string;
  description?: string;
  coverImage?: string;
  allowJoinRequest?: boolean;
}

export function updateWikiInfo(id: string, data: UpdateWikiInfoInput): Promise<Wiki> {
  return prisma.wiki.update({where: {id}, data});
}

export interface WikiTeamDirectoryEntry {
  id: string;
  name: string;
  description: string | null;
  coverImage: string | null;
  allowJoinRequest: boolean;
  isMember: boolean;
}

/**
 * 团队工作区目录：只选取元信息字段 + 用一个 boolean 表达"我是否已是成员"，
 * 不 select 完整的 members 列表或任何文档相关字段——这是"仅元信息可见"边界的落地方式
 * （见 team-workspace-model spec.md「团队成员可浏览团队内工作区目录」）。
 */
export async function listWikiDirectoryByTeam(
  teamId: string,
  userId: string
): Promise<WikiTeamDirectoryEntry[]> {
  const wikis = await prisma.wiki.findMany({
    where: {teamId},
    select: {
      id: true,
      name: true,
      description: true,
      coverImage: true,
      allowJoinRequest: true,
      members: {where: {userId}, select: {id: true}}
    },
    orderBy: {updatedAt: 'desc'}
  });

  return wikis.map(wiki => ({
    id: wiki.id,
    name: wiki.name,
    description: wiki.description,
    coverImage: wiki.coverImage,
    allowJoinRequest: wiki.allowJoinRequest,
    isMember: wiki.members.length > 0
  }));
}

/**
 * 单独更新 ownerId：成员角色变更/移除导致 ownerId 当前指向的用户不再是 OWNER 时，
 * 由 services/wiki.ts 的 syncWikiOwnerIfNeeded 在同一事务内调用（见
 * wiki-workspace-fixes design.md 决策 3、spec.md「工作区拥有者引用与实际 OWNER 保持一致」）。
 */
export function updateWikiOwner(
  id: string,
  ownerId: string,
  client: Client = prisma
): Promise<Wiki> {
  return client.wiki.update({where: {id}, data: {ownerId}});
}

/** WikiMember 记录通过 schema 的 onDelete: Cascade 自动级联删除，不需要在这里手动清理 */
export function deleteWiki(id: string): Promise<Wiki> {
  return prisma.wiki.delete({where: {id}});
}

/**
 * 转移工作区归属的 Team：转移后不在新 Team 的原有 WikiMember 立即在下一次权限判断时失效
 * （运行时计算，不需要主动清理记录，见 team-workspace-model spec.md「工作区归属团队」）。
 */
export function updateWikiTeam(id: string, teamId: string): Promise<Wiki> {
  return prisma.wiki.update({where: {id}, data: {teamId}});
}

/** 搜索接口用：`ILIKE`（`contains` + `insensitive`）匹配名称/简介，范围限定在调用方已确认
 * 当前用户可访问的 wikiId 集合内（见 wiki-search spec.md「按关键字通过后端接口查询匹配结果」） */
export function searchWikisByIds(wikiIds: string[], keyword: string): Promise<Wiki[]> {
  return prisma.wiki.findMany({
    where: {
      id: {in: wikiIds},
      OR: [
        {name: {contains: keyword, mode: 'insensitive'}},
        {description: {contains: keyword, mode: 'insensitive'}}
      ]
    },
    orderBy: {updatedAt: 'desc'}
  });
}
