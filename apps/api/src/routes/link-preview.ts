import {Router} from 'express';
import {linkPreviewHandler} from '../handlers/link-preview';
import {requireAuth} from '../middlewares/require-auth';

export const linkPreviewRouter = Router();

/** 只要求登录，不绑定具体 Wiki——链接预览是编辑器内的通用能力（见 link-preview spec.md） */
linkPreviewRouter.post('/link-preview', requireAuth, linkPreviewHandler);
