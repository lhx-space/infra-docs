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

/** 列出用户所属的全部 Team（含个人 Team），按加入时间排序，用于创建 Wiki 时的归属选择列表 */
export function listTeamsByUserId(userId: string): Promise<Team[]> {
  return prisma.team.findMany({
    where: {members: {some: {userId}}},
    orderBy: {createdAt: 'asc'}
  });
}

export function updateTeamName(id: string, name: string): Promise<Team> {
  return prisma.team.update({where: {id}, data: {name}});
}

/** TeamMember/Wiki 记录通过 schema 的 onDelete: Cascade 自动级联删除，这里不需要手动清理 */
export function deleteTeam(id: string, client: Client = prisma): Promise<Team> {
  return client.team.delete({where: {id}});
}
