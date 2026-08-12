import type {NextFunction, Request, Response} from 'express';
import {z} from 'zod';
import * as teamInviteService from '../services/team-invite';
import {isValidUuid} from '../utils/uuid';

const createInviteSchema = z.object({
  maxUses: z.number().int().positive().optional(),
  expiresAt: z.string().datetime().optional()
});

/** 统一把 service 层的 TeamInviteError 映射为对应的 HTTP 状态码（对齐 handlers/team.ts） */
function respondToServiceError(err: unknown, res: Response, next: NextFunction): void {
  if (err instanceof teamInviteService.TeamInviteError) {
    res.status(err.status).json({error: err.message});
    return;
  }
  next(err);
}

/** teamId 存在性 + 当前用户是 OWNER 已由 requireTeamRole('OWNER') 中间件校验过 */
export async function createInviteHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const userId = req.user?.id;
  if (userId === undefined) {
    res.status(401).json({error: 'unauthorized'});
    return;
  }

  const parsed = createInviteSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({error: 'invalid_input', details: parsed.error.flatten()});
    return;
  }

  try {
    const invite = await teamInviteService.createInvite(req.params['teamId'] as string, userId, {
      maxUses: parsed.data.maxUses,
      expiresAt: parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : undefined
    });
    res.status(201).json({invite});
  } catch (err) {
    respondToServiceError(err, res, next);
  }
}

export async function revokeInviteHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const inviteId = req.params['inviteId'];
  if (!inviteId || !isValidUuid(inviteId)) {
    res.status(404).json({error: 'not_found'});
    return;
  }

  try {
    await teamInviteService.revokeInvite(inviteId, req.params['teamId'] as string);
    res.json({status: 'ok'});
  } catch (err) {
    respondToServiceError(err, res, next);
  }
}

/** 兑换链接不要求当前用户已经属于任何团队角色，只要求登录，所以不挂 requireTeamRole */
export async function redeemInviteHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const userId = req.user?.id;
  if (userId === undefined) {
    res.status(401).json({error: 'unauthorized'});
    return;
  }

  try {
    const result = await teamInviteService.redeemInvite(req.params['token'] as string, userId);
    res.json(result);
  } catch (err) {
    respondToServiceError(err, res, next);
  }
}
