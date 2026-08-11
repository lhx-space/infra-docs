import {Router} from 'express';
import {
  addMemberHandler,
  createWikiHandler,
  deleteWikiHandler,
  getWikiHandler,
  listMembersHandler,
  listWikisHandler,
  removeMemberHandler,
  updateMemberRoleHandler,
  updateWikiInfoHandler
} from '../handlers/wiki';
import {requireAuth} from '../middlewares/require-auth';
import {requireWikiRole} from '../middlewares/require-wiki-role';

export const wikiRouter = Router();

wikiRouter.use(requireAuth);

wikiRouter.get('/wikis', listWikisHandler);
wikiRouter.post('/wikis', createWikiHandler);

wikiRouter.get('/wikis/:wikiId', requireWikiRole('VIEWER'), getWikiHandler);
wikiRouter.patch('/wikis/:wikiId', requireWikiRole('EDITOR'), updateWikiInfoHandler);
wikiRouter.delete('/wikis/:wikiId', requireWikiRole('OWNER'), deleteWikiHandler);

wikiRouter.get('/wikis/:wikiId/members', requireWikiRole('VIEWER'), listMembersHandler);
wikiRouter.post('/wikis/:wikiId/members', requireWikiRole('OWNER'), addMemberHandler);
wikiRouter.patch(
  '/wikis/:wikiId/members/:userId',
  requireWikiRole('OWNER'),
  updateMemberRoleHandler
);
wikiRouter.delete('/wikis/:wikiId/members/:userId', requireWikiRole('OWNER'), removeMemberHandler);
