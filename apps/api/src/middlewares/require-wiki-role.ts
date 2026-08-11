import type {NextFunction, Request, Response} from 'express';
import type {WikiRole} from '../generated/prisma/client';
import {findWikiById} from '../models/wiki';
import {findWikiMember} from '../models/wiki-member';
import {isValidUuid} from '../utils/uuid';

declare global {
  namespace Express {
    interface Request {
      /** 由 requireWikiRole 中间件注入，仅在挂载了该中间件的路由上存在 */
      wikiRole?: WikiRole;
    }
  }
}

/** 角色权重：OWNER 完全包含 EDITOR 权限，EDITOR 完全包含 VIEWER 权限（见 design.md 决策 1） */
const ROLE_WEIGHT: Record<WikiRole, number> = {
  OWNER: 3,
  EDITOR: 2,
  VIEWER: 1
};

/**
 * 基于角色的工作区访问权限中间件，挂在 `requireAuth` 之后使用（依赖 `req.user.id`）。
 * 从 `req.params['wikiId']` 读取目标工作区，校验当前用户在该工作区的角色是否达到 `minRole`：
 *
 * - 工作区不存在 → `404 not_found`
 * - 当前用户不是该工作区任何成员，或角色权重不够 → 统一 `403 forbidden`
 *   （不区分"不是成员"和"是成员但权限不够"，避免向非成员泄露工作区成员结构）
 * - 校验通过 → 把角色挂到 `req.wikiRole`，供下游 handler 做更细粒度的行为判断
 *
 * 命名和实现风格对齐 `require-auth.ts`（`declare global` 扩展 `Express.Request`、
 * 统一的错误响应格式），保持中间件写法一致（见 design.md 决策 2）。
 */
export function requireWikiRole(minRole: WikiRole) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
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

    const wiki = await findWikiById(wikiId);
    if (!wiki) {
      res.status(404).json({error: 'not_found'});
      return;
    }

    const member = await findWikiMember(wikiId, userId);
    if (!member || ROLE_WEIGHT[member.role] < ROLE_WEIGHT[minRole]) {
      res.status(403).json({error: 'forbidden'});
      return;
    }

    req.wikiRole = member.role;
    next();
  };
}
