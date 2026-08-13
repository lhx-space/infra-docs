import type {NextFunction, Request, Response} from 'express';
import multer from 'multer';
import {getVideoStatus, uploadVideo, VideoError} from '../services/video';
import {isValidUuid} from '../utils/uuid';

/** 见 design.md Risks：给视频上传设置一个明确的大小上限，防止排队等待转码期间的存储占用不可控 */
const MAX_FILE_SIZE_BYTES = 500 * 1024 * 1024;

/** fileFilter 拒绝非视频类型时用这个标记错误，跟 multer 自身的 LIMIT_FILE_SIZE 错误分开识别
 * （风格对齐 handlers/upload.ts 现有图片校验） */
class InvalidFileTypeError extends Error {}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {fileSize: MAX_FILE_SIZE_BYTES},
  fileFilter: (_req, file, callback) => {
    if (!file.mimetype.startsWith('video/')) {
      callback(new InvalidFileTypeError());
      return;
    }
    callback(null, true);
  }
}).single('file');

export function uploadVideoMiddleware(req: Request, res: Response, next: NextFunction): void {
  upload(req, res, (err: unknown) => {
    if (err instanceof InvalidFileTypeError) {
      res.status(400).json({error: 'invalid_file_type'});
      return;
    }
    if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
      res.status(400).json({error: 'file_too_large'});
      return;
    }
    if (err) {
      next(err);
      return;
    }
    next();
  });
}

export async function uploadVideoHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  if (!req.file) {
    res.status(400).json({error: 'invalid_file_type'});
    return;
  }

  const userId = req.user?.id;
  if (userId === undefined) {
    res.status(401).json({error: 'unauthorized'});
    return;
  }

  try {
    const result = await uploadVideo(req.file.buffer, req.file.mimetype, userId);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

export async function getVideoStatusHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const assetId = req.params['id'];
  if (!assetId || !isValidUuid(assetId)) {
    res.status(404).json({error: 'not_found'});
    return;
  }

  try {
    const result = await getVideoStatus(assetId);
    res.json(result);
  } catch (err) {
    if (err instanceof VideoError) {
      res.status(err.status).json({error: err.message});
      return;
    }
    next(err);
  }
}
