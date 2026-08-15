import {Router} from 'express';
import {authRouter} from './auth';
import {documentRouter} from './document';
import {documentExportRouter} from './document-export';
import {healthRouter} from './health';
import {linkPreviewRouter} from './link-preview';
import {searchRouter} from './search';
import {teamRouter} from './team';
import {uploadRouter} from './upload';
import {userRouter} from './user';
import {videoRouter} from './video';
import {wikiRouter} from './wiki';

export const router = Router();

router.use('/healthz', healthRouter);
router.use('/auth', authRouter);
router.use(userRouter);
router.use(teamRouter);
router.use(wikiRouter);
router.use(documentRouter);
router.use(documentExportRouter);
router.use(linkPreviewRouter);
router.use(searchRouter);
router.use(uploadRouter);
router.use(videoRouter);
