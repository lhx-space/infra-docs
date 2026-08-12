import type {Request, Response} from 'express';
import {z} from 'zod';
import {upsertUserProfile} from '../models/user-profile';
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
 * 只接受并更新 nickname/avatarUrl/bio 三个字段——跟 `/me` GET 暴露的字段边界保持一致，
 * 即使请求体里携带 gender/birthday/phone 等字段，zod schema 本身就不认识它们，
 * 天然被忽略，不需要额外的白名单过滤逻辑（见 wiki-integration-gaps design.md 决策 6）。
 */
const updateProfileSchema = z.object({
  nickname: z.string().max(50).optional(),
  avatarUrl: z.string().max(2048).optional(),
  bio: z.string().max(500).optional()
});

export async function updateProfileHandler(req: Request, res: Response): Promise<void> {
  const userId = req.user?.id;
  if (userId === undefined) {
    res.status(401).json({error: 'unauthorized'});
    return;
  }

  const parsed = updateProfileSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({error: 'invalid_input', details: parsed.error.flatten()});
    return;
  }

  const profile = await upsertUserProfile(userId, parsed.data);
  res.json({
    profile: {nickname: profile.nickname, avatarUrl: profile.avatarUrl, bio: profile.bio}
  });
}
