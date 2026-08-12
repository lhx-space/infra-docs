import {Router} from 'express';
import {
  addMemberHandler,
  createWikiHandler,
  deleteWikiHandler,
  getWikiHandler,
  listMembersHandler,
  listWikisHandler,
  removeMemberHandler,
  transferWikiTeamHandler,
  updateMemberRoleHandler,
  updateWikiInfoHandler
} from '../handlers/wiki';
import {
  createJoinRequestHandler,
  listPendingJoinRequestsHandler,
  reviewJoinRequestHandler
} from '../handlers/wiki-join-request';
import {
  createShareLinkHandler,
  redeemShareLinkHandler,
  revokeShareLinkHandler
} from '../handlers/wiki-share-link';
import {requireAuth} from '../middlewares/require-auth';
import {requireWikiRole} from '../middlewares/require-wiki-role';

export const wikiRouter = Router();

wikiRouter.use(requireAuth);

wikiRouter.get('/wikis', listWikisHandler);
wikiRouter.post('/wikis', createWikiHandler);

wikiRouter.get('/wikis/:wikiId', requireWikiRole('VIEWER'), getWikiHandler);
wikiRouter.patch('/wikis/:wikiId', requireWikiRole('EDITOR'), updateWikiInfoHandler);
wikiRouter.patch('/wikis/:wikiId/team', requireWikiRole('OWNER'), transferWikiTeamHandler);
wikiRouter.delete('/wikis/:wikiId', requireWikiRole('OWNER'), deleteWikiHandler);

wikiRouter.get('/wikis/:wikiId/members', requireWikiRole('VIEWER'), listMembersHandler);
wikiRouter.post('/wikis/:wikiId/members', requireWikiRole('OWNER'), addMemberHandler);
wikiRouter.patch(
  '/wikis/:wikiId/members/:userId',
  requireWikiRole('OWNER'),
  updateMemberRoleHandler
);
wikiRouter.delete('/wikis/:wikiId/members/:userId', requireWikiRole('OWNER'), removeMemberHandler);

// 分享链接：OWNER/EDITOR 都能生成，撤销收紧为仅 OWNER；兑换只要求登录，不要求已是该 Wiki 成员
wikiRouter.post('/wikis/:wikiId/share-links', requireWikiRole('EDITOR'), createShareLinkHandler);
wikiRouter.delete(
  '/wikis/:wikiId/share-links/:linkId',
  requireWikiRole('OWNER'),
  revokeShareLinkHandler
);
wikiRouter.post('/share-links/:token/redeem', redeemShareLinkHandler);

// 申请加入：发起不要求已是成员，只挂全局 requireAuth；列表/审批要求当前用户是该 Wiki 的 OWNER
wikiRouter.post('/wikis/:wikiId/join-requests', createJoinRequestHandler);
wikiRouter.get(
  '/wikis/:wikiId/join-requests',
  requireWikiRole('OWNER'),
  listPendingJoinRequestsHandler
);
wikiRouter.patch(
  '/wikis/:wikiId/join-requests/:requestId',
  requireWikiRole('OWNER'),
  reviewJoinRequestHandler
);
