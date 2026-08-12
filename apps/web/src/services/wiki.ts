import {http} from '@/network';

export type WikiRole = 'OWNER' | 'EDITOR' | 'VIEWER';

export interface Wiki {
  id: string;
  name: string;
  description: string | null;
  coverImage: string | null;
  ownerId: string;
  teamId: string;
  allowJoinRequest: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface WikiMember {
  id: string;
  wikiId: string;
  userId: string;
  role: WikiRole;
  createdAt: string;
  /** 只有 GET /wikis/:wikiId/members（用 Prisma 关联查询带出用户名）才会返回这个字段，
   * add/updateRole/remove 几个写接口的响应体里没有——调用方需要用户名时应该用 lookupUser
   * 拿到的结果自己拼一份本地展示对象，不要假设这个字段总是存在 */
  user?: {id: string; username: string};
}

export interface CreateWikiInput {
  name: string;
  description?: string;
  coverImage?: string;
  teamId?: string;
}

export interface UpdateWikiInfoInput {
  name?: string;
  description?: string;
  coverImage?: string;
  allowJoinRequest?: boolean;
}

export function transferWikiTeam(wikiId: string, teamId: string): Promise<{wiki: Wiki}> {
  return http.patch<{wiki: Wiki}>(`/wikis/${wikiId}/team`, {teamId});
}

/**
 * 对 `/wikis` 系列接口的薄封装，风格对齐 `services/user.ts`：只负责"发请求、拿结果"，
 * 不做错误码翻译（翻译交给调用方 `store/wiki.ts`），不依赖 zustand。
 */
export function listWikis(): Promise<{wikis: Wiki[]}> {
  return http.get<{wikis: Wiki[]}>('/wikis');
}

export function createWiki(input: CreateWikiInput): Promise<{wiki: Wiki}> {
  return http.post<{wiki: Wiki}>('/wikis', input);
}

export function getWiki(wikiId: string): Promise<{wiki: Wiki; role: WikiRole}> {
  return http.get<{wiki: Wiki; role: WikiRole}>(`/wikis/${wikiId}`);
}

export function updateWikiInfo(wikiId: string, input: UpdateWikiInfoInput): Promise<{wiki: Wiki}> {
  return http.patch<{wiki: Wiki}>(`/wikis/${wikiId}`, input);
}

export function deleteWiki(wikiId: string): Promise<{status: string}> {
  return http.delete<{status: string}>(`/wikis/${wikiId}`);
}

export function listMembers(wikiId: string): Promise<{members: WikiMember[]}> {
  return http.get<{members: WikiMember[]}>(`/wikis/${wikiId}/members`);
}

export function addMember(
  wikiId: string,
  userId: string,
  role: WikiRole
): Promise<{member: WikiMember}> {
  return http.post<{member: WikiMember}>(`/wikis/${wikiId}/members`, {userId, role});
}

export function updateMemberRole(
  wikiId: string,
  userId: string,
  role: WikiRole
): Promise<{member: WikiMember}> {
  return http.patch<{member: WikiMember}>(`/wikis/${wikiId}/members/${userId}`, {role});
}

export function removeMember(wikiId: string, userId: string): Promise<{status: string}> {
  return http.delete<{status: string}>(`/wikis/${wikiId}/members/${userId}`);
}
