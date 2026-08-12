import {prisma} from '../db/prisma';
import type {Prisma, PrismaClient, WikiRole, WikiShareLink} from '../generated/prisma/client';

export type {WikiShareLink};

/** 允许调用方传入事务客户端（tx），保证跨多次查询/写入的原子性；不传时默认走全局单例 */
type Client = PrismaClient | Prisma.TransactionClient;

export interface CreateShareLinkInput {
  wikiId: string;
  token: string;
  role: WikiRole;
  expiresAt?: Date;
  createdBy: string;
}

export function createShareLink(
  input: CreateShareLinkInput,
  client: Client = prisma
): Promise<WikiShareLink> {
  return client.wikiShareLink.create({data: input});
}

export function findShareLinkByToken(
  token: string,
  client: Client = prisma
): Promise<WikiShareLink | null> {
  return client.wikiShareLink.findUnique({where: {token}});
}

export function findShareLinkById(
  id: string,
  client: Client = prisma
): Promise<WikiShareLink | null> {
  return client.wikiShareLink.findUnique({where: {id}});
}

export function revokeShareLink(id: string, client: Client = prisma): Promise<WikiShareLink> {
  return client.wikiShareLink.update({where: {id}, data: {revokedAt: new Date()}});
}
