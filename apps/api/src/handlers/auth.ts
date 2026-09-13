import type {NextFunction, Request, Response} from 'express';
import {z} from 'zod';
import {env} from '../env';
import * as authService from '../services/auth';

export const REFRESH_TOKEN_COOKIE = 'refresh_token';
/**
 * 限定为 `/auth`（而非最初设计的 `/auth/refresh`）：
 * 浏览器按 Cookie 路径前缀匹配，`path=/auth/refresh` 的 Cookie 不会带到 `/auth/logout`，
 * 会导致登出无法读取、吊销 Refresh Token。`/auth` 仍限定在 auth 路由命名空间内，不暴露给全站其他路由。
 */
export const REFRESH_TOKEN_COOKIE_PATH = '/auth';

/** 移动端等无法使用 httpOnly cookie 的客户端：用此请求头声明「refresh token 走请求/响应 body」的 bearer 模式 */
export const AUTH_MODE_HEADER = 'x-auth-mode';
const BEARER_MODE = 'bearer';

function isBearerMode(req: Request): boolean {
  return req.header(AUTH_MODE_HEADER)?.toLowerCase() === BEARER_MODE;
}

/** 按当前鉴权模式取 refresh token：bearer 模式从 body 读，否则从 cookie 读 */
function readRefreshToken(req: Request): string | undefined {
  if (isBearerMode(req)) {
    const body = req.body as {refreshToken?: unknown} | undefined;
    return typeof body?.refreshToken === 'string' ? body.refreshToken : undefined;
  }
  return (req.cookies as Record<string, string> | undefined)?.[REFRESH_TOKEN_COOKIE];
}

const registerSchema = z.object({
  email: z.string().email(),
  username: z.string().min(3).max(32),
  password: z.string().min(8).max(72)
});

const loginSchema = z.object({
  /** 支持 email 或 username 登录 */
  identifier: z.string().min(1),
  password: z.string().min(1)
});

function setRefreshTokenCookie(res: Response, token: string, ttlSeconds: number): void {
  res.cookie(REFRESH_TOKEN_COOKIE, token, {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: REFRESH_TOKEN_COOKIE_PATH,
    maxAge: ttlSeconds * 1000
  });
}

function clearRefreshTokenCookie(res: Response): void {
  res.clearCookie(REFRESH_TOKEN_COOKIE, {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: REFRESH_TOKEN_COOKIE_PATH
  });
}

/** 统一把 service 层的 AuthError 映射为对应的 HTTP 状态码，未知错误交给全局错误中间件 */
function respondToServiceError(err: unknown, res: Response, next: NextFunction): void {
  if (err instanceof authService.AuthError) {
    res.status(err.status).json({error: err.message});
    return;
  }
  next(err);
}

export async function registerHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({error: 'invalid_input', details: parsed.error.flatten()});
    return;
  }

  try {
    const user = await authService.register(parsed.data);
    res.status(201).json({user});
  } catch (err) {
    respondToServiceError(err, res, next);
  }
}

export async function loginHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({error: 'invalid_input', details: parsed.error.flatten()});
    return;
  }

  try {
    const {user, tokens} = await authService.login(parsed.data.identifier, parsed.data.password);
    if (isBearerMode(req)) {
      res.json({
        user,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        refreshTokenTtlSeconds: tokens.refreshTokenTtlSeconds
      });
      return;
    }
    setRefreshTokenCookie(res, tokens.refreshToken, tokens.refreshTokenTtlSeconds);
    res.json({user, accessToken: tokens.accessToken});
  } catch (err) {
    respondToServiceError(err, res, next);
  }
}

export async function refreshHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const refreshToken = readRefreshToken(req);
  if (!refreshToken) {
    res.status(401).json({error: 'invalid_refresh_token'});
    return;
  }

  try {
    const {user, tokens} = await authService.refresh(refreshToken);
    if (isBearerMode(req)) {
      res.json({
        user,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        refreshTokenTtlSeconds: tokens.refreshTokenTtlSeconds
      });
      return;
    }
    setRefreshTokenCookie(res, tokens.refreshToken, tokens.refreshTokenTtlSeconds);
    res.json({user, accessToken: tokens.accessToken});
  } catch (err) {
    respondToServiceError(err, res, next);
  }
}

export async function logoutHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const refreshToken = readRefreshToken(req);

  try {
    await authService.logout(refreshToken);
    if (!isBearerMode(req)) {
      clearRefreshTokenCookie(res);
    }
    res.json({status: 'ok'});
  } catch (err) {
    respondToServiceError(err, res, next);
  }
}
