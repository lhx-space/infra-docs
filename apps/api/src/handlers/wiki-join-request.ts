import type {NextFunction, Request, Response} from 'express';
import {z} from 'zod';
import type {WikiRole} from '../generated/prisma/client';
import * as joinRequestService from '../services/wiki-join-request';
import {isValidUuid} from '../utils/uuid';

const reviewJoinRequestSchema = z.object({
  approve: z.boolean(),
  role: z.enum(['OWNER', 'EDITOR', 'VIEWER']).optional()
});

/** 统一把 service 层的 WikiJoinRequestError 映射为对应的 HTTP 状态码（对齐 handlers/wiki.ts） */
function respondToServiceError(err: unknown, res: Response, next: NextFunction): void {
  if (err instanceof joinRequestService.WikiJoinRequestError) {
    res.status(err.status).json({error: err.message});
    return;
  }
  next(err);
}

/** 发起申请不要求当前用户已是该 Wiki 成员（恰恰相反），所以这个路由只挂 requireAuth，不挂 requireWikiRole */
export async function createJoinRequestHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const userId = req.user?.id;
  if (userId === undefined) {
    res.status(401).json({error: 'unauthorized'});
    return;
  }

  const wikiId = req.params['wikiId'];
  if (!wikiId || !isValidUuid(wikiId)) {
    res.status(404).json({error: 'not_found'});
    return;
  }

  try {
    const request = await joinRequestService.createJoinRequest(
      req.params['wikiId'] as string,
      userId
    );
    res.status(201).json({request});
  } catch (err) {
    respondToServiceError(err, res, next);
  }
}

/** wikiId 存在性 + 当前用户是 OWNER 已由 requireWikiRole('OWNER') 中间件校验过 */
export async function listPendingJoinRequestsHandler(req: Request, res: Response): Promise<void> {
  const requests = await joinRequestService.listPendingJoinRequests(req.params['wikiId'] as string);
  res.json({requests});
}

/** wikiId 存在性 + 当前用户是 OWNER 已由 requireWikiRole('OWNER') 中间件校验过 */
export async function reviewJoinRequestHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const userId = req.user?.id;
  if (userId === undefined) {
    res.status(401).json({error: 'unauthorized'});
    return;
  }

  const requestId = req.params['requestId'];
  if (!requestId || !isValidUuid(requestId)) {
    res.status(404).json({error: 'not_found'});
    return;
  }

  const parsed = reviewJoinRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({error: 'invalid_input', details: parsed.error.flatten()});
    return;
  }

  try {
    await joinRequestService.reviewJoinRequest(requestId, req.params['wikiId'] as string, userId, {
      approve: parsed.data.approve,
      role: parsed.data.role as WikiRole | undefined
    });
    res.json({status: 'ok'});
  } catch (err) {
    respondToServiceError(err, res, next);
  }
}
