import type {WikiRole} from '../generated/prisma/client';
import {findDocumentById} from '../models/document';
import {isTeamOwner} from '../models/team-member';
import {findWikiById} from '../models/wiki';
import {findWikiMember} from '../models/wiki-member';

/**
 * "Team OWNER 兜底 + WikiMember 查询"这条判断逻辑的唯一实现——从
 * `middlewares/require-wiki-role.ts` 提取出来的纯函数（不依赖 Express 的 req/res），
 * 目的是让 HTTP 中间件与 gRPC 的 `AccessControlService.CheckDocumentRole`（见
 * openspec/changes/yjs-realtime-collaboration design.md 决策 2）共用同一份实现，
 * 不产生两份逐渐漂移的权限判断代码。
 *
 * `granted: false` 时用 `reason` 区分"工作区不存在"与"不是任何角色成员"，
 * 分别对应现有 HTTP 语义的 404/403；调用方（中间件、gRPC handler）各自决定怎么
 * 把这两种情况映射成自己协议下的错误表达。
 */
export type WikiAccessResult =
  | {granted: false; reason: 'not_found' | 'forbidden'}
  | {granted: true; role: WikiRole};

export async function checkWikiAccess(wikiId: string, userId: string): Promise<WikiAccessResult> {
  const wiki = await findWikiById(wikiId);
  if (!wiki) {
    return {granted: false, reason: 'not_found'};
  }

  if (await isTeamOwner(wiki.teamId, userId)) {
    return {granted: true, role: 'OWNER'};
  }

  const member = await findWikiMember(wikiId, userId);
  if (!member) {
    return {granted: false, reason: 'forbidden'};
  }

  return {granted: true, role: member.role};
}

/**
 * 供 gRPC `AccessControlService.CheckDocumentRole` 使用（见 yjs-realtime-collaboration
 * design.md 决策 2/4）：`collab-server` 建立协同连接时，按 `documentId` 反查所属 Wiki
 * 再走上面同一套 `checkWikiAccess` 判断，不重新实现权限规则。
 */
export async function checkDocumentAccess(
  documentId: string,
  userId: string
): Promise<WikiAccessResult> {
  const document = await findDocumentById(documentId);
  if (!document) {
    return {granted: false, reason: 'not_found'};
  }
  return checkWikiAccess(document.wikiId, userId);
}
