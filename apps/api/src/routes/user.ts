import {Router} from 'express';
import {meHandler} from '../handlers/user';
import {requireAuth} from '../middlewares/require-auth';

export const userRouter = Router();

userRouter.get('/me', requireAuth, meHandler);
