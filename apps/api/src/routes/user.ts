import {Router} from 'express';
import {lookupUserHandler, meHandler} from '../handlers/user';
import {requireAuth} from '../middlewares/require-auth';

export const userRouter = Router();

userRouter.get('/me', requireAuth, meHandler);
/**
 * 仅挂 requireAuth，不做角色限制：任何登录用户都能查，这是"添加成员"流程的前置步骤，
 * 真正的写权限校验在 POST /wikis/:wikiId/members 那一步（requireWikiRole('OWNER')）（见 design.md 决策 6）。
 */
userRouter.get('/users/lookup', requireAuth, lookupUserHandler);
