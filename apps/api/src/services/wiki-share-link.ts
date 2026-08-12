import {prisma} from '../db/prisma';
import {Prisma, type WikiRole, type WikiShareLink} from '../generated/prisma/client';
import {findTeamMember} from '../models/team-member';
import {findWikiById} from '../models/wiki';
import {createWikiMember, findWikiMember, updateWikiMemberRole} from '../models/wiki-member';
import {
  createShareLink as createShareLinkModel,
  findShareLinkById,
  findShareLinkByToken,
  revokeShareLink as revokeShareLinkModel
} from '../models/wiki-share-link';
import {generateToken} from '../utils/random-token';
import {isWikiRoleAtLeast} from '../utils/wiki-role';

/** 风格对齐 services/wiki.ts 的 WikiError：status + message，handler 层统一映射成 HTTP 状态码 */
export class WikiShareLinkError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'WikiShareLinkError';
    this.status = status;
  }
}

export interface CreateShareLinkInput {
  role: WikiRole;
  expiresAt?: Date;
}

/**
 * 生成分享链接：分享者只能生成一个不超过自己当前角色的链接（见 design.md 决策 8）。
 * `creatorRole` 由调用方（handler）从 `req.wikiRole` 传入，不在这里重复查一次。
 */
export function createShareLink(
  wikiId: string,
  createdBy: string,
  creatorRole: WikiRole,
  input: CreateShareLinkInput
): Promise<WikiShareLink> {
  if (!isWikiRoleAtLeast(creatorRole, input.role)) {
    throw new WikiShareLinkError(403, 'role_exceeds_creator');
  }
  return createShareLinkModel({
    wikiId,
    token: generateToken(),
    role: input.role,
    expiresAt: input.expiresAt,
    createdBy
  });
}

export async function revokeShareLink(id: string, wikiId: string): Promise<void> {
  const link = await findShareLinkById(id);
  if (!link || link.wikiId !== wikiId) {
    throw new WikiShareLinkError(404, 'not_found');
  }
  await revokeShareLinkModel(id);
}

/**
 * 兑换分享链接：链接只对同 Team 成员生效，不允许绕过团队边界直接获得工作区权限
 * （见 design.md 决策 8）。已有不低于该角色的身份时幂等返回；已有更低角色时升级为链接
 * 授予的角色；两种情况都不重复报错。
 */
export async function redeemShareLink(token: string, userId: string): Promise<{wikiId: string}> {
  return prisma.$transaction(async tx => {
    const link = await findShareLinkByToken(token, tx);
    if (!link) throw new WikiShareLinkError(404, 'not_found');
    if (link.revokedAt || (link.expiresAt && link.expiresAt <= new Date())) {
      throw new WikiShareLinkError(410, 'link_expired');
    }

    const wiki = await findWikiById(link.wikiId, tx);
    if (!wiki) throw new WikiShareLinkError(404, 'not_found');

    const teamMembership = await findTeamMember(wiki.teamId, userId, tx);
    if (!teamMembership) {
      throw new WikiShareLinkError(403, 'not_team_member');
    }

    const existing = await findWikiMember(link.wikiId, userId, tx);
    if (existing) {
      if (isWikiRoleAtLeast(existing.role, link.role)) {
        return {wikiId: link.wikiId}; // 已有不低于该角色的身份，幂等返回
      }
      await updateWikiMemberRole(link.wikiId, userId, link.role, tx);
      return {wikiId: link.wikiId};
    }

    try {
      await createWikiMember(link.wikiId, userId, link.role, tx);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return {wikiId: link.wikiId}; // 并发下另一个请求已经创建成功，视为幂等成功
      }
      throw err;
    }
    return {wikiId: link.wikiId};
  });
}
