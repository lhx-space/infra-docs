import type {WikiRole} from '../generated/prisma/client';

/** 角色权重：OWNER 完全包含 EDITOR 权限，EDITOR 完全包含 VIEWER 权限（跟 middlewares/require-wiki-role.ts 共用） */
export const WIKI_ROLE_WEIGHT: Record<WikiRole, number> = {
  OWNER: 3,
  EDITOR: 2,
  VIEWER: 1
};

export function isWikiRoleAtLeast(role: WikiRole, minRole: WikiRole): boolean {
  return WIKI_ROLE_WEIGHT[role] >= WIKI_ROLE_WEIGHT[minRole];
}
