import {Router} from 'express';
import {uploadImageHandler, uploadImageMiddleware} from '../handlers/upload';
import {requireAuth} from '../middlewares/require-auth';

export const uploadRouter = Router();

/**
 * 通用图片上传接口，不绑定 Wiki 这一个场景（见 design.md 决策 3）。
 * 只要求登录（requireAuth），不做"这张图归谁"的所有权记录——当前唯一用途是拿 URL 填进
 * Wiki.coverImage，上传接口本身只管"存下来给个 URL"。
 */
uploadRouter.post('/uploads/images', requireAuth, uploadImageMiddleware, uploadImageHandler);
