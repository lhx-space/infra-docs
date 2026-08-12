import {Router} from 'express';
import {searchHandler} from '../handlers/search';
import {requireAuth} from '../middlewares/require-auth';

export const searchRouter = Router();

/** 覆盖 Wiki 名称/简介 + Document 标题/正文（见 wiki-search spec.md），只要求登录，不绑定具体 Wiki */
searchRouter.get('/search', requireAuth, searchHandler);
