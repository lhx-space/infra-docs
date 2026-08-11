import type {Request, Response} from 'express';
import {findUserByEmail, findUserByUsername} from '../models/user';
import {findProfileByUserId} from '../models/user-profile';
import {getMe} from '../services/user';

/** 返回当前登录用户的公开信息 + 资料字段（nickname/avatarUrl/bio），用于用户菜单展示 */
export async function meHandler(req: Request, res: Response): Promise<void> {
  const userId = req.user?.id;
  if (userId === undefined) {
    res.status(401).json({error: 'unauthorized'});
    return;
  }

  const result = await getMe(userId);
  if (!result) {
    // token 校验通过但用户已不存在（如账号被删除）：仍统一按未鉴权处理，而不是 404/500
    res.status(401).json({error: 'unauthorized'});
    return;
  }

  res.json(result);
}

/**
 * 按标识符精确查找用户（用于"添加 Wiki 成员"场景，见 design.md 决策 6）：
 * identifier 含 `@` 走邮箱查找，否则走用户名查找，跟 `services/auth.ts` 的 `login()` 完全一致的判断逻辑。
 * 只返回公开字段（id/username/avatarUrl），不返回 email，避免这个接口被拿去当邮箱查找器。
 */
export async function lookupUserHandler(req: Request, res: Response): Promise<void> {
  const identifier = req.query['identifier'];
  if (typeof identifier !== 'string' || identifier.length === 0) {
    res.status(400).json({error: 'invalid_input'});
    return;
  }

  const user = identifier.includes('@')
    ? await findUserByEmail(identifier)
    : await findUserByUsername(identifier);

  if (!user) {
    res.status(404).json({error: 'user_not_found'});
    return;
  }

  const profile = await findProfileByUserId(user.id);
  res.json({id: user.id, username: user.username, avatarUrl: profile?.avatarUrl ?? null});
}
