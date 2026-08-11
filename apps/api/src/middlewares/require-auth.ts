import type {NextFunction, Request, Response} from 'express';
import {verifyAccessToken} from '../services/token';

declare global {
  namespace Express {
    interface Request {
      /** 由 requireAuth 中间件注入，仅在挂载了该中间件的路由上存在。id 是 UUID v7 字符串 */
      user?: {id: string};
    }
  }
}

const BEARER_PREFIX = 'Bearer ';

function extractBearerToken(header: string | undefined): string | null {
  if (!header?.startsWith(BEARER_PREFIX)) return null;
  const token = header.slice(BEARER_PREFIX.length).trim();
  return token.length > 0 ? token : null;
}

/**
 * 保护路由的鉴权中间件：从 `Authorization: Bearer <token>` 中取出 access token 并校验，
 * 校验通过后把 `{ id: userId }` 挂到 `req.user`，供下游 handler 读取。
 *
 * 校验失败（缺失 header / 格式不对 / token 过期或签名无效）统一返回 401 `{ error: 'unauthorized' }`，
 * 不区分具体失败原因，避免向客户端暴露 token 失效的细节（见 design.md 决策 2）。
 *
 * 必须显式挂载在需要保护的路由上（如 `router.use('/me', requireAuth, meRouter)`），
 * 不要 `app.use(requireAuth)` 全局应用，否则会误伤 `/healthz`、`/auth/*` 等本不需要鉴权的路由。
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = extractBearerToken(req.header('authorization'));
  if (!token) {
    res.status(401).json({error: 'unauthorized'});
    return;
  }

  try {
    const {sub} = await verifyAccessToken(token);
    req.user = {id: sub};
    next();
  } catch {
    res.status(401).json({error: 'unauthorized'});
  }
}
