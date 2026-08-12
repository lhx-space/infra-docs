import {prisma} from '../db/prisma';
import type {Prisma, PrismaClient, TeamInvite, TeamRole} from '../generated/prisma/client';

export type {TeamInvite};

/** 允许调用方传入事务客户端（tx），保证跨多次查询/写入的原子性；不传时默认走全局单例 */
type Client = PrismaClient | Prisma.TransactionClient;

export interface CreateTeamInviteInput {
  teamId: string;
  token: string;
  role: TeamRole;
  maxUses?: number;
  expiresAt?: Date;
  createdBy: string;
}

export function createTeamInvite(
  input: CreateTeamInviteInput,
  client: Client = prisma
): Promise<TeamInvite> {
  return client.teamInvite.create({data: input});
}

export function findTeamInviteByToken(
  token: string,
  client: Client = prisma
): Promise<TeamInvite | null> {
  return client.teamInvite.findUnique({where: {token}});
}

export function findTeamInviteById(
  id: string,
  client: Client = prisma
): Promise<TeamInvite | null> {
  return client.teamInvite.findUnique({where: {id}});
}

export function revokeTeamInvite(id: string, client: Client = prisma): Promise<TeamInvite> {
  return client.teamInvite.update({where: {id}, data: {revokedAt: new Date()}});
}
