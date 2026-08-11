import {Router} from 'express';
import {authRouter} from './auth';
import {healthRouter} from './health';
import {userRouter} from './user';

export const router = Router();

router.use('/healthz', healthRouter);
router.use('/auth', authRouter);
router.use(userRouter);
