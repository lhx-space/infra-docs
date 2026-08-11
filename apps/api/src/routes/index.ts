import {Router} from 'express';
import {authRouter} from './auth';
import {healthRouter} from './health';
import {uploadRouter} from './upload';
import {userRouter} from './user';
import {wikiRouter} from './wiki';

export const router = Router();

router.use('/healthz', healthRouter);
router.use('/auth', authRouter);
router.use(userRouter);
router.use(wikiRouter);
router.use(uploadRouter);
