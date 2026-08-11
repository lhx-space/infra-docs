import type {NextFunction, Request, Response} from 'express';
import {z} from 'zod';
import type {WikiRole} from '../generated/prisma/client';
import * as wikiService from '../services/wiki';
import {isValidUuid} from '../utils/uuid';

const createWikiSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  coverImage: z.string().url().optional()
});

const updateWikiInfoSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  coverImage: z.string().url().optional()
});

const addMemberSchema = z.object({
  userId: z.string().uuid(),
  role: z.enum(['OWNER', 'EDITOR', 'VIEWER'])
});

const updateMemberRoleSchema = z.object({
  role: z.enum(['OWNER', 'EDITOR', 'VIEWER'])
});

/** 统一把 service 层的 WikiError 映射为对应的 HTTP 状态码，未知错误交给全局错误中间件（对齐 handlers/auth.ts） */
function respondToServiceError(err: unknown, res: Response, next: NextFunction): void {
  if (err instanceof wikiService.WikiError) {
    res.status(err.status).json({error: err.message});
    return;
  }
  next(err);
}

export async function listWikisHandler(req: Request, res: Response): Promise<void> {
  const userId = req.user?.id;
  if (userId === undefined) {
    res.status(401).json({error: 'unauthorized'});
    return;
  }

  const wikis = await wikiService.listMyWikis(userId);
  res.json({wikis});
}

export async function createWikiHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const userId = req.user?.id;
  if (userId === undefined) {
    res.status(401).json({error: 'unauthorized'});
    return;
  }

  const parsed = createWikiSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({error: 'invalid_input', details: parsed.error.flatten()});
    return;
  }

  try {
    const wiki = await wikiService.createWiki(userId, parsed.data);
    res.status(201).json({wiki});
  } catch (err) {
    respondToServiceError(err, res, next);
  }
}

/** wikiId 存在性 + 当前用户角色已由 requireWikiRole 中间件校验过（含格式校验），这里只需要把结果查出来返回 */
export async function getWikiHandler(req: Request, res: Response): Promise<void> {
  const wiki = await wikiService.getWiki(req.params['wikiId'] as string);
  res.json({wiki, role: req.wikiRole});
}

export async function updateWikiInfoHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const parsed = updateWikiInfoSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({error: 'invalid_input', details: parsed.error.flatten()});
    return;
  }

  try {
    const wiki = await wikiService.updateWikiInfo(req.params['wikiId'] as string, parsed.data);
    res.json({wiki});
  } catch (err) {
    respondToServiceError(err, res, next);
  }
}

export async function deleteWikiHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    await wikiService.deleteWiki(req.params['wikiId'] as string);
    res.json({status: 'ok'});
  } catch (err) {
    respondToServiceError(err, res, next);
  }
}

export async function listMembersHandler(req: Request, res: Response): Promise<void> {
  const members = await wikiService.listWikiMembers(req.params['wikiId'] as string);
  res.json({members});
}

export async function addMemberHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const parsed = addMemberSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({error: 'invalid_input', details: parsed.error.flatten()});
    return;
  }

  try {
    const member = await wikiService.addWikiMember(
      req.params['wikiId'] as string,
      parsed.data.userId,
      parsed.data.role as WikiRole
    );
    res.status(201).json({member});
  } catch (err) {
    respondToServiceError(err, res, next);
  }
}

export async function updateMemberRoleHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const targetUserId = req.params['userId'];
  if (!targetUserId || !isValidUuid(targetUserId)) {
    res.status(404).json({error: 'not_found'});
    return;
  }

  const parsed = updateMemberRoleSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({error: 'invalid_input', details: parsed.error.flatten()});
    return;
  }

  try {
    const member = await wikiService.updateWikiMemberRole(
      req.params['wikiId'] as string,
      targetUserId,
      parsed.data.role as WikiRole
    );
    res.json({member});
  } catch (err) {
    respondToServiceError(err, res, next);
  }
}

export async function removeMemberHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const targetUserId = req.params['userId'];
  if (!targetUserId || !isValidUuid(targetUserId)) {
    res.status(404).json({error: 'not_found'});
    return;
  }

  try {
    await wikiService.removeWikiMember(req.params['wikiId'] as string, targetUserId);
    res.json({status: 'ok'});
  } catch (err) {
    respondToServiceError(err, res, next);
  }
}
