import {prisma} from '../db/prisma';
import type {User, UserStatus} from '../generated/prisma/client';

export type {User, UserStatus};

export interface UpdateUserInput {
  email?: string;
  username?: string;
  password?: string;
  status?: UserStatus;
}

export function findUserById(id: string): Promise<User | null> {
  return prisma.user.findUnique({where: {id}});
}

export function findUserByEmail(email: string): Promise<User | null> {
  return prisma.user.findUnique({where: {email}});
}

export function findUserByUsername(username: string): Promise<User | null> {
  return prisma.user.findUnique({where: {username}});
}

/** 附带详情表数据一起查出来 */
export function findUserWithProfile(id: string) {
  return prisma.user.findUnique({where: {id}, include: {profile: true}});
}

export function updateUser(id: string, data: UpdateUserInput): Promise<User> {
  return prisma.user.update({where: {id}, data});
}

export function deleteUser(id: string): Promise<User> {
  return prisma.user.delete({where: {id}});
}

export function listUsers(): Promise<User[]> {
  return prisma.user.findMany({orderBy: {id: 'asc'}});
}

/** 批量查用户 + 详情表的 nickname/avatarUrl（见 services/document-version.ts 的
 * 「历史编辑人列表」用法），不用 `findUserWithProfile` 逐个查——避免 N+1 */
export function findUsersWithProfileByIds(ids: string[]) {
  return prisma.user.findMany({
    where: {id: {in: ids}},
    include: {profile: true}
  });
}
