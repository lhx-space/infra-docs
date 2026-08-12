import {Router} from 'express';
import {meHandler, updateProfileHandler} from '../handlers/user';
import {requireAuth} from '../middlewares/require-auth';

export const userRouter = Router();

userRouter.get('/me', requireAuth, meHandler);
userRouter.patch('/me/profile', requireAuth, updateProfileHandler);
