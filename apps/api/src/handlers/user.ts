import type {Request, Response} from 'express';
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
