import type {NextFunction, Request, Response} from 'express';
import {z} from 'zod';
import type {TeamRole} from '../generated/prisma/client';
import * as teamService from '../services/team';
import {isValidUuid} from '../utils/uuid';

const createTeamSchema = z.object({name: z.string().min(1).max(100)});
const updateTeamSchema = z.object({name: z.string().min(1).max(100)});
const updateTeamMemberRoleSchema = z.object({role: z.enum(['OWNER', 'MEMBER'])});

/** 统一把 service 层的 TeamError 映射为对应的 HTTP 状态码，未知错误交给全局错误中间件（对齐 handlers/wiki.ts） */
function respondToServiceError(err: unknown, res: Response, next: NextFunction): void {
  if (err instanceof teamService.TeamError) {
    res.status(err.status).json({error: err.message});
    return;
  }
  next(err);
}

export async function listMyTeamsHandler(req: Request, res: Response): Promise<void> {
  const userId = req.user?.id;
  if (userId === undefined) {
    res.status(401).json({error: 'unauthorized'});
    return;
  }

  const teams = await teamService.listMyTeams(userId);
  res.json({teams});
}

export async function createTeamHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const userId = req.user?.id;
  if (userId === undefined) {
    res.status(401).json({error: 'unauthorized'});
    return;
  }

  const parsed = createTeamSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({error: 'invalid_input', details: parsed.error.flatten()});
    return;
  }

  try {
    const team = await teamService.createTeam(userId, parsed.data.name);
    res.status(201).json({team});
  } catch (err) {
    respondToServiceError(err, res, next);
  }
}

/** teamId 存在性 + 当前用户角色已由 requireTeamRole 中间件校验过，这里只需要把结果查出来返回 */
export async function getTeamHandler(req: Request, res: Response): Promise<void> {
  const team = await teamService.getTeam(req.params['teamId'] as string);
  res.json({team, role: req.teamRole});
}

export async function updateTeamHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const parsed = updateTeamSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({error: 'invalid_input', details: parsed.error.flatten()});
    return;
  }

  try {
    const team = await teamService.updateTeam(req.params['teamId'] as string, parsed.data.name);
    res.json({team});
  } catch (err) {
    respondToServiceError(err, res, next);
  }
}

export async function deleteTeamHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    await teamService.deleteTeam(req.params['teamId'] as string);
    res.json({status: 'ok'});
  } catch (err) {
    respondToServiceError(err, res, next);
  }
}

export async function listTeamMembersHandler(req: Request, res: Response): Promise<void> {
  const members = await teamService.listTeamMembers(req.params['teamId'] as string);
  res.json({members});
}

/** teamId 存在性 + 当前用户是团队成员已由 requireTeamRole('MEMBER') 中间件校验过 */
export async function listTeamWikisHandler(req: Request, res: Response): Promise<void> {
  const userId = req.user?.id;
  if (userId === undefined) {
    res.status(401).json({error: 'unauthorized'});
    return;
  }

  const wikis = await teamService.listTeamWikis(req.params['teamId'] as string, userId);
  res.json({wikis});
}

export async function updateTeamMemberRoleHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const targetUserId = req.params['userId'];
  if (!targetUserId || !isValidUuid(targetUserId)) {
    res.status(404).json({error: 'not_found'});
    return;
  }

  const parsed = updateTeamMemberRoleSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({error: 'invalid_input', details: parsed.error.flatten()});
    return;
  }

  try {
    const member = await teamService.updateTeamMemberRole(
      req.params['teamId'] as string,
      targetUserId,
      parsed.data.role as TeamRole
    );
    res.json({member});
  } catch (err) {
    respondToServiceError(err, res, next);
  }
}

/**
 * 移除成员/主动退出复用同一个接口：路由层用 `requireTeamRole('MEMBER')` 只保证"是团队成员"，
 * 这里再判断——目标是自己（退出）总是允许，目标是别人（移除）则要求当前用户是 `OWNER`。
 */
export async function removeTeamMemberHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const targetUserId = req.params['userId'];
  if (!targetUserId || !isValidUuid(targetUserId)) {
    res.status(404).json({error: 'not_found'});
    return;
  }

  const isSelf = targetUserId === req.user?.id;
  if (!isSelf && req.teamRole !== 'OWNER') {
    res.status(403).json({error: 'forbidden'});
    return;
  }

  try {
    await teamService.removeTeamMember(req.params['teamId'] as string, targetUserId);
    res.json({status: 'ok'});
  } catch (err) {
    respondToServiceError(err, res, next);
  }
}
