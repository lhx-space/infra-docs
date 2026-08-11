import {prisma} from '../db/prisma';
import type {User, UserStatus} from '../generated/prisma/client';

export type {User, UserStatus};

export interface CreateUserInput {
  email: string;
  username: string;
  /** 已加密后的密码 hash，加密逻辑由调用方（service/route 层）负责 */
  password: string;
  status?: UserStatus;
}

export interface UpdateUserInput {
  email?: string;
  username?: string;
  password?: string;
  status?: UserStatus;
}

export function createUser(data: CreateUserInput): Promise<User> {
  return prisma.user.create({data});
}

export function findUserById(id: number): Promise<User | null> {
  return prisma.user.findUnique({where: {id}});
}

export function findUserByEmail(email: string): Promise<User | null> {
  return prisma.user.findUnique({where: {email}});
}

export function findUserByUsername(username: string): Promise<User | null> {
  return prisma.user.findUnique({where: {username}});
}

/** 附带详情表数据一起查出来 */
export function findUserWithProfile(id: number) {
  return prisma.user.findUnique({where: {id}, include: {profile: true}});
}

export function updateUser(id: number, data: UpdateUserInput): Promise<User> {
  return prisma.user.update({where: {id}, data});
}

export function deleteUser(id: number): Promise<User> {
  return prisma.user.delete({where: {id}});
}

export function listUsers(): Promise<User[]> {
  return prisma.user.findMany({orderBy: {id: 'asc'}});
}
