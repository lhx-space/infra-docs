import {allowRefreshToken, isRefreshTokenAllowed, revokeRefreshToken} from '../cache/index';
import {
  createUser,
  findUserByEmail,
  findUserById,
  findUserByUsername,
  type User
} from '../models/user';
import {hashPassword, verifyPassword} from './password';
import {
  getRefreshTokenTtlSeconds,
  signAccessToken,
  signRefreshToken,
  TokenVerificationError,
  verifyRefreshToken
} from './token';

export class AuthError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'AuthError';
    this.status = status;
  }
}

export type PublicUser = Omit<User, 'password'>;

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  refreshTokenTtlSeconds: number;
}

export interface RegisterInput {
  email: string;
  username: string;
  password: string;
}

export interface LoginResult {
  user: PublicUser;
  tokens: AuthTokens;
}

export function toPublicUser(user: User): PublicUser {
  const {password: _password, ...publicUser} = user;
  return publicUser;
}

async function issueTokens(userId: number): Promise<AuthTokens> {
  const accessToken = await signAccessToken(userId);
  const {token: refreshToken, jti} = await signRefreshToken(userId);
  const refreshTokenTtlSeconds = getRefreshTokenTtlSeconds();
  await allowRefreshToken(String(userId), jti, refreshTokenTtlSeconds);
  return {accessToken, refreshToken, refreshTokenTtlSeconds};
}

export async function register(input: RegisterInput): Promise<PublicUser> {
  const [existingByEmail, existingByUsername] = await Promise.all([
    findUserByEmail(input.email),
    findUserByUsername(input.username)
  ]);
  if (existingByEmail || existingByUsername) {
    throw new AuthError(409, 'email_or_username_taken');
  }

  const passwordHash = await hashPassword(input.password);
  const user = await createUser({
    email: input.email,
    username: input.username,
    password: passwordHash
  });
  return toPublicUser(user);
}

/** 登录失败（用户不存在 / 密码错误）统一返回同一个通用错误，避免泄露账号是否存在 */
export async function login(identifier: string, password: string): Promise<LoginResult> {
  const user = identifier.includes('@')
    ? await findUserByEmail(identifier)
    : await findUserByUsername(identifier);

  if (!user) {
    throw new AuthError(401, 'invalid_credentials');
  }

  const passwordMatches = await verifyPassword(password, user.password);
  if (!passwordMatches) {
    throw new AuthError(401, 'invalid_credentials');
  }

  const tokens = await issueTokens(user.id);
  return {user: toPublicUser(user), tokens};
}

export async function refresh(refreshToken: string): Promise<LoginResult> {
  let sub: string;
  let jti: string;
  try {
    const payload = await verifyRefreshToken(refreshToken);
    sub = payload.sub;
    jti = payload.jti;
  } catch (err) {
    if (err instanceof TokenVerificationError) {
      throw new AuthError(401, 'invalid_refresh_token');
    }
    throw err;
  }

  const allowed = await isRefreshTokenAllowed(sub, jti);
  if (!allowed) {
    throw new AuthError(401, 'invalid_refresh_token');
  }

  // Rotation：先吊销旧 token，再签发新的一对
  await revokeRefreshToken(sub, jti);

  const userId = Number(sub);
  const user = await findUserById(userId);
  if (!user) {
    throw new AuthError(401, 'invalid_refresh_token');
  }

  const tokens = await issueTokens(user.id);
  return {user: toPublicUser(user), tokens};
}

export async function logout(refreshToken: string | undefined): Promise<void> {
  if (!refreshToken) return;
  try {
    const {sub, jti} = await verifyRefreshToken(refreshToken);
    await revokeRefreshToken(sub, jti);
  } catch {
    // token 已失效/格式错误：登出本身是幂等操作，无需报错
  }
}
