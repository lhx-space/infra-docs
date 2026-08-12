import {allowRefreshToken, isRefreshTokenAllowed, revokeRefreshToken} from '../cache/index';
import {prisma} from '../db/prisma';
import {findUserByEmail, findUserById, findUserByUsername, type User} from '../models/user';
import {buildDicebearUrl} from '../utils/dicebear';
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

/**
 * 默认头像：DiceBear 按 username 做种子生成的确定性头像，注册时直接算好写入 `UserProfile.avatarUrl`，
 * 不再交给前端每次现算——项目是 web + desktop 双端共享同一个后端，头像规则只在这一处实现，
 * 任何客户端只需要读 `profile.avatarUrl` 就能拿到可用的头像，不用各自重复"没头像时怎么生成"这条规则。
 *
 * 权衡：种子在注册这一刻就固定写入了，如果以后支持修改用户名，这个已存的 URL 不会跟着自动变
 * （目前没有改用户名功能，这个代价是 0；如果以后加了，需要在改名逻辑里同步重新生成一次头像）。
 */
function buildDefaultAvatarUrl(username: string): string {
  return buildDicebearUrl('glass', username);
}

async function issueTokens(userId: string): Promise<AuthTokens> {
  const accessToken = await signAccessToken(userId);
  const {token: refreshToken, jti} = await signRefreshToken(userId);
  const refreshTokenTtlSeconds = getRefreshTokenTtlSeconds();
  await allowRefreshToken(userId, jti, refreshTokenTtlSeconds);
  return {accessToken, refreshToken, refreshTokenTtlSeconds};
}

/**
 * 注册：用事务原子性地同时创建 User + 带默认头像的 UserProfile + 一个"个人 Team"
 * （isPersonal: true，该用户 OWNER）。个人 Team 是用户唯一的组织归属容器，不需要
 * 任何额外操作即可拥有——个人即团队，没有"个人模式/团队模式"两套逻辑（见
 * team-workspace-model design.md 决策 1、spec.md「注册时自动创建个人 Team」）。
 */
export async function register(input: RegisterInput): Promise<PublicUser> {
  const [existingByEmail, existingByUsername] = await Promise.all([
    findUserByEmail(input.email),
    findUserByUsername(input.username)
  ]);
  if (existingByEmail || existingByUsername) {
    throw new AuthError(409, 'email_or_username_taken');
  }

  const passwordHash = await hashPassword(input.password);
  const user = await prisma.$transaction(async tx => {
    const created = await tx.user.create({
      data: {email: input.email, username: input.username, password: passwordHash}
    });
    await tx.userProfile.create({
      data: {userId: created.id, avatarUrl: buildDefaultAvatarUrl(input.username)}
    });
    const team = await tx.team.create({data: {name: '我的空间', isPersonal: true}});
    await tx.teamMember.create({data: {teamId: team.id, userId: created.id, role: 'OWNER'}});
    return created;
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

  const user = await findUserById(sub);
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
