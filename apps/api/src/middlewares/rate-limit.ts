import type {RequestHandler} from 'express';
import {rateLimit} from 'express-rate-limit';
import {env} from '../env';

const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;

/** 开发/测试环境直接放行，保持 routes 层挂载代码始终一致，不需要 if/else 散落在路由文件里 */
const passthrough: RequestHandler = (_req, _res, next) => next();

function createLimiter(limit: number): RequestHandler {
  return rateLimit({
    windowMs: FIFTEEN_MINUTES_MS,
    limit,
    standardHeaders: true,
    legacyHeaders: false
  });
}

const isProduction = env.NODE_ENV === 'production';

/** 登录接口限流：5 次/15 分钟，仅生产环境启用 */
export const loginRateLimiter: RequestHandler = isProduction ? createLimiter(5) : passthrough;

/** 注册接口限流：20 次/15 分钟，仅生产环境启用 */
export const registerRateLimiter: RequestHandler = isProduction ? createLimiter(20) : passthrough;
