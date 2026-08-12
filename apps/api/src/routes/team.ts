import {Router} from 'express';
import {
  createTeamHandler,
  deleteTeamHandler,
  getTeamHandler,
  listMyTeamsHandler,
  listTeamMembersHandler,
  listTeamWikisHandler,
  removeTeamMemberHandler,
  updateTeamHandler,
  updateTeamMemberRoleHandler
} from '../handlers/team';
import {
  createInviteHandler,
  redeemInviteHandler,
  revokeInviteHandler
} from '../handlers/team-invite';
import {requireAuth} from '../middlewares/require-auth';
import {requireTeamRole} from '../middlewares/require-team-role';

export const teamRouter = Router();

teamRouter.use(requireAuth);

teamRouter.get('/teams/mine', listMyTeamsHandler);
teamRouter.post('/teams', createTeamHandler);

teamRouter.get('/teams/:teamId', requireTeamRole('MEMBER'), getTeamHandler);
teamRouter.patch('/teams/:teamId', requireTeamRole('OWNER'), updateTeamHandler);
teamRouter.delete('/teams/:teamId', requireTeamRole('OWNER'), deleteTeamHandler);

teamRouter.get('/teams/:teamId/members', requireTeamRole('MEMBER'), listTeamMembersHandler);
teamRouter.get('/teams/:teamId/wikis', requireTeamRole('MEMBER'), listTeamWikisHandler);
teamRouter.patch(
  '/teams/:teamId/members/:userId',
  requireTeamRole('OWNER'),
  updateTeamMemberRoleHandler
);
// 退出（自己）/ 移除（他人）复用同一路由，中间件只保证"是团队成员"，更细的授权在 handler 里判断
teamRouter.delete(
  '/teams/:teamId/members/:userId',
  requireTeamRole('MEMBER'),
  removeTeamMemberHandler
);

// 邀请链接：生成/失效只有 OWNER 能做；兑换不要求当前用户已属于这个团队，只挂全局的 requireAuth
teamRouter.post('/teams/:teamId/invites', requireTeamRole('OWNER'), createInviteHandler);
teamRouter.delete(
  '/teams/:teamId/invites/:inviteId',
  requireTeamRole('OWNER'),
  revokeInviteHandler
);
teamRouter.post('/invites/:token/redeem', redeemInviteHandler);
