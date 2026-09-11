import {prisma} from '../db/prisma';
import type {Prisma, PrismaClient, Team} from '../generated/prisma/client';

export type {Team};

/** 允许调用方传入事务客户端（tx），保证跨多次查询/写入的原子性；不传时默认走全局单例 */
type Client = PrismaClient | Prisma.TransactionClient;

export function createTeam(
  name: string,
  isPersonal: boolean,
  client: Client = prisma
): Promise<Team> {
  return client.team.create({data: {name, isPersonal}});
}

export function findTeamById(id: string, client: Client = prisma): Promise<Team | null> {
  return client.team.findUnique({where: {id}});
}

/** 查找某个用户的个人 Team（注册时自动创建，全局唯一），用于创建 Wiki 时的默认归属 */
export function findPersonalTeam(userId: string, client: Client = prisma): Promise<Team | null> {
  return client.team.findFirst({where: {isPersonal: true, members: {some: {userId}}}});
}

/** 团队列表项：在裸 `Team` 实体之上附加统计字段（成员数/Wiki 数/文档总数），供前端数据看板表格展示 */
export interface TeamListItem extends Team {
  memberCount: number;
  wikiCount: number;
  documentCount: number;
}

/** 列出用户所属的全部 Team（含个人 Team），按加入时间排序，用于创建 Wiki 时的归属选择列表。
 * 成员数/Wiki 数用一次 `_count` 拿到；文档总数通过一次对 `Wiki` 的 `_count.documents` 查询
 * 按 teamId 聚合得到（Document 上没有 teamId 标量，无法直接 groupBy teamId，需经 wiki 中转）。 */
export async function listTeamsByUserId(userId: string): Promise<TeamListItem[]> {
  const teams = await prisma.team.findMany({
    where: {members: {some: {userId}}},
    orderBy: {createdAt: 'asc'},
    include: {_count: {select: {members: true, wikis: true}}}
  });

  const teamIds = teams.map(t => t.id);
  const wikiDocRows =
    teamIds.length === 0
      ? []
      : await prisma.wiki.findMany({
          where: {teamId: {in: teamIds}},
          select: {teamId: true, _count: {select: {documents: true}}}
        });
  const docCountMap = new Map<string, number>();
  for (const row of wikiDocRows) {
    docCountMap.set(row.teamId, (docCountMap.get(row.teamId) ?? 0) + row._count.documents);
  }

  return teams.map(t => ({
    id: t.id,
    name: t.name,
    isPersonal: t.isPersonal,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    memberCount: t._count.members,
    wikiCount: t._count.wikis,
    documentCount: docCountMap.get(t.id) ?? 0
  }));
}

export function updateTeamName(id: string, name: string): Promise<Team> {
  return prisma.team.update({where: {id}, data: {name}});
}

/** TeamMember/Wiki 记录通过 schema 的 onDelete: Cascade 自动级联删除，这里不需要手动清理 */
export function deleteTeam(id: string, client: Client = prisma): Promise<Team> {
  return client.team.delete({where: {id}});
}
