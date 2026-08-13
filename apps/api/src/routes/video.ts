import {Router} from 'express';
import {getVideoStatusHandler, uploadVideoHandler, uploadVideoMiddleware} from '../handlers/video';
import {requireAuth} from '../middlewares/require-auth';

export const videoRouter = Router();

/**
 * 视频上传 + 转码状态查询（见 video-transcoding spec.md）。不绑定 Wiki/Document 这一个
 * 具体场景（跟 routes/upload.ts 的图片上传是同一个设计取向），只要求登录，上传成功立即
 * 返回处理中状态，不等待转码完成。
 */
videoRouter.post('/videos', requireAuth, uploadVideoMiddleware, uploadVideoHandler);
videoRouter.get('/videos/:id', requireAuth, getVideoStatusHandler);
