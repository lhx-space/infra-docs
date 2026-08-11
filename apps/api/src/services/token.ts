import {randomUUID} from 'node:crypto';
import {errors, jwtVerify, SignJWT} from 'jose';
import {env} from '../env';

const ALG = 'HS256';

const accessSecret = new TextEncoder().encode(env.JWT_SECRET);
const refreshSecret = new TextEncoder().encode(env.REFRESH_TOKEN_SECRET);

const TTL_UNIT_SECONDS = {
  s: 1,
  m: 60,
  h: 60 * 60,
  d: 60 * 60 * 24,
  w: 60 * 60 * 24 * 7
} as const;

type TtlUnit = keyof typeof TTL_UNIT_SECONDS;

/** 把 '15m' / '7d' 这类 TTL 字符串转成秒数，供 Redis TTL / Cookie maxAge 复用，避免与 JWT 过期时间不同步 */
export function parseTtlToSeconds(ttl: string): number {
  const match = /^(\d+)(s|m|h|d|w)$/.exec(ttl.trim());
  if (!match) throw new Error(`invalid TTL format: ${ttl}`);
  const amount = Number(match[1]);
  const unit = match[2] as TtlUnit;
  return amount * TTL_UNIT_SECONDS[unit];
}

export function getAccessTokenTtlSeconds(): number {
  return parseTtlToSeconds(env.ACCESS_TOKEN_TTL);
}

export function getRefreshTokenTtlSeconds(): number {
  return parseTtlToSeconds(env.REFRESH_TOKEN_TTL);
}

export interface AccessTokenPayload {
  /** userId */
  sub: string;
}

export interface RefreshTokenPayload {
  /** userId */
  sub: string;
  /** token id，用于 Redis 白名单匹配 */
  jti: string;
}

export interface SignedRefreshToken {
  token: string;
  jti: string;
}

/** 区分"签名无效/过期"与"算法不匹配"两类校验失败，便于上层统一映射为 401 */
export type TokenErrorKind = 'expired' | 'algorithm_mismatch' | 'invalid';

export class TokenVerificationError extends Error {
  readonly kind: TokenErrorKind;

  constructor(kind: TokenErrorKind, message?: string) {
    super(message ?? kind);
    this.name = 'TokenVerificationError';
    this.kind = kind;
  }
}

function mapVerificationError(err: unknown): TokenVerificationError {
  if (err instanceof TokenVerificationError) return err;
  if (err instanceof errors.JWTExpired) return new TokenVerificationError('expired', err.message);
  if (err instanceof errors.JOSEAlgNotAllowed)
    return new TokenVerificationError('algorithm_mismatch', err.message);
  const message = err instanceof Error ? err.message : 'token verification failed';
  return new TokenVerificationError('invalid', message);
}

export async function signAccessToken(userId: number | string): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({alg: ALG})
    .setSubject(String(userId))
    .setIssuedAt()
    .setExpirationTime(env.ACCESS_TOKEN_TTL)
    .sign(accessSecret);
}

export async function verifyAccessToken(token: string): Promise<AccessTokenPayload> {
  try {
    const {payload} = await jwtVerify(token, accessSecret, {algorithms: [ALG]});
    if (!payload.sub) throw new TokenVerificationError('invalid', 'missing sub claim');
    return {sub: payload.sub};
  } catch (err) {
    throw mapVerificationError(err);
  }
}

export async function signRefreshToken(userId: number | string): Promise<SignedRefreshToken> {
  const jti = randomUUID();
  const token = await new SignJWT({})
    .setProtectedHeader({alg: ALG})
    .setSubject(String(userId))
    .setJti(jti)
    .setIssuedAt()
    .setExpirationTime(env.REFRESH_TOKEN_TTL)
    .sign(refreshSecret);
  return {token, jti};
}

export async function verifyRefreshToken(token: string): Promise<RefreshTokenPayload> {
  try {
    const {payload} = await jwtVerify(token, refreshSecret, {algorithms: [ALG]});
    if (!payload.sub || !payload.jti)
      throw new TokenVerificationError('invalid', 'missing sub/jti claim');
    return {sub: payload.sub, jti: payload.jti};
  } catch (err) {
    throw mapVerificationError(err);
  }
}
