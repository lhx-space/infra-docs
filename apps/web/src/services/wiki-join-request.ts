import {http} from '@/network';
import type {WikiRole} from './wiki';

export type JoinRequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface WikiJoinRequest {
  id: string;
  wikiId: string;
  userId: string;
  status: JoinRequestStatus;
  reviewedBy: string | null;
  reviewedAt: string | null;
  createdAt: string;
  /** 只有 GET /wikis/:wikiId/join-requests（OWNER 视角列表）才会带出用户名 */
  user?: {id: string; username: string};
}

export function createJoinRequest(wikiId: string): Promise<{request: WikiJoinRequest}> {
  return http.post<{request: WikiJoinRequest}>(`/wikis/${wikiId}/join-requests`);
}

export function listPendingJoinRequests(wikiId: string): Promise<{requests: WikiJoinRequest[]}> {
  return http.get<{requests: WikiJoinRequest[]}>(`/wikis/${wikiId}/join-requests`);
}

export function reviewJoinRequest(
  wikiId: string,
  requestId: string,
  approve: boolean,
  role?: WikiRole
): Promise<{status: string}> {
  return http.patch<{status: string}>(`/wikis/${wikiId}/join-requests/${requestId}`, {
    approve,
    role
  });
}
