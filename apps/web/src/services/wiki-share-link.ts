import {http} from '@/network';
import type {WikiRole} from './wiki';

export interface WikiShareLink {
  id: string;
  wikiId: string;
  token: string;
  role: WikiRole;
  expiresAt: string | null;
  revokedAt: string | null;
  createdBy: string;
  createdAt: string;
}

export function createShareLink(
  wikiId: string,
  role: WikiRole,
  expiresAt?: string
): Promise<{link: WikiShareLink}> {
  return http.post<{link: WikiShareLink}>(`/wikis/${wikiId}/share-links`, {role, expiresAt});
}

export function revokeShareLink(wikiId: string, linkId: string): Promise<{status: string}> {
  return http.delete<{status: string}>(`/wikis/${wikiId}/share-links/${linkId}`);
}

export function redeemShareLink(token: string): Promise<{wikiId: string}> {
  return http.post<{wikiId: string}>(`/share-links/${token}/redeem`);
}
