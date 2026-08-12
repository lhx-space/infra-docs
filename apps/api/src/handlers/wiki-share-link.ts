import type {NextFunction, Request, Response} from 'express';
import {z} from 'zod';
import type {WikiRole} from '../generated/prisma/client';
import * as shareLinkService from '../services/wiki-share-link';
import {isValidUuid} from '../utils/uuid';

const createShareLinkSchema = z.object({
  role: z.enum(['OWNER', 'EDITOR', 'VIEWER']),
  expiresAt: z.string().datetime().optional()
});

/** 统一把 service 层的 WikiShareLinkError 映射为对应的 HTTP 状态码（对齐 handlers/wiki.ts） */
function respondToServiceError(err: unknown, res: Response, next: NextFunction): void {
  if (err instanceof shareLinkService.WikiShareLinkError) {
    res.status(err.status).json({error: err.message});
    return;
  }
  next(err);
}

/** wikiId 存在性 + 当前用户角色已由 requireWikiRole('EDITOR') 中间件校验过，角色上限校验在 service 层做 */
export async function createShareLinkHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const userId = req.user?.id;
  if (userId === undefined) {
    res.status(401).json({error: 'unauthorized'});
    return;
  }

  const parsed = createShareLinkSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({error: 'invalid_input', details: parsed.error.flatten()});
    return;
  }

  try {
    const link = await shareLinkService.createShareLink(
      req.params['wikiId'] as string,
      userId,
      req.wikiRole as WikiRole,
      {
        role: parsed.data.role as WikiRole,
        expiresAt: parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : undefined
      }
    );
    res.status(201).json({link});
  } catch (err) {
    respondToServiceError(err, res, next);
  }
}

export async function revokeShareLinkHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const linkId = req.params['linkId'];
  if (!linkId || !isValidUuid(linkId)) {
    res.status(404).json({error: 'not_found'});
    return;
  }

  try {
    await shareLinkService.revokeShareLink(linkId, req.params['wikiId'] as string);
    res.json({status: 'ok'});
  } catch (err) {
    respondToServiceError(err, res, next);
  }
}

/** 兑换不要求当前用户已属于这个 Wiki，只要求登录，所以不挂 requireWikiRole */
export async function redeemShareLinkHandler(
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
    const result = await shareLinkService.redeemShareLink(req.params['token'] as string, userId);
    res.json(result);
  } catch (err) {
    respondToServiceError(err, res, next);
  }
}
