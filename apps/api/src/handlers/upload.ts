import type {NextFunction, Request, Response} from 'express';
import multer from 'multer';
import {uploadImage} from '../services/storage';

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;

/** fileFilter 拒绝非图片类型时用这个标记错误，跟 multer 自身的 LIMIT_FILE_SIZE 错误分开识别 */
class InvalidFileTypeError extends Error {}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {fileSize: MAX_FILE_SIZE_BYTES},
  fileFilter: (_req, file, callback) => {
    if (!file.mimetype.startsWith('image/')) {
      callback(new InvalidFileTypeError());
      return;
    }
    callback(null, true);
  }
}).single('file');

/**
 * 手动包一层而不是直接把 `upload` 挂进路由：multer 的校验错误（文件类型/大小）需要翻译成
 * `{ error: 'invalid_file_type' }` / `{ error: 'file_too_large' }` 这种跟项目里其他接口一致的
 * 错误体，而不是交给全局错误中间件吐出裸的 500（那个只应该处理真正未预期的异常）。
 */
export function uploadImageMiddleware(req: Request, res: Response, next: NextFunction): void {
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

export async function uploadImageHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  if (!req.file) {
    res.status(400).json({error: 'invalid_file_type'});
    return;
  }

  try {
    const result = await uploadImage(req.file.buffer);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}
