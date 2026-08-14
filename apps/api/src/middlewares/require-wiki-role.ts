import type {NextFunction, Request, Response} from 'express';
import type {WikiRole} from '../generated/prisma/client';
import {checkWikiAccess} from '../services/wiki-access';
import {isValidUuid} from '../utils/uuid';
import {WIKI_ROLE_WEIGHT} from '../utils/wiki-role';

declare global {
  namespace Express {
    interface Request {
      /** 由 requireWikiRole 中间件注入，仅在挂载了该中间件的路由上存在 */
      wikiRole?: WikiRole;
    }
  }
}

/**
 * 基于角色的工作区访问权限中间件，挂在 `requireAuth` 之后使用（依赖 `req.user.id`）。
 * 从 `req.params['wikiId']` 读取目标工作区，校验当前用户在该工作区的角色是否达到 `minRole`：
 *
 * - 工作区不存在 → `404 not_found`
 * - **先判断该 Wiki 所属 Team 的 OWNER 兜底权限**：是则直接视为该 Wiki 的 `OWNER`，
 *   不再查询 `WikiMember` 表，也不受该表里任何显式记录（即使角色更低）限制——这条权限
 *   是运行时计算、不落库，不需要跟 `WikiMember` 做任何同步（见 team-workspace-model
 *   design.md 决策 3、spec.md「基于团队所有者的运行时权限兜底」）
 * - 不是 Team OWNER 时，再查 `WikiMember`；当前用户不是该工作区任何成员，或角色权重
 *   不够 → 统一 `403 forbidden`（不区分"不是成员"和"是成员但权限不够"，避免向非成员
 *   泄露工作区成员结构）
 * - 校验通过 → 把角色挂到 `req.wikiRole`，供下游 handler 做更细粒度的行为判断
 *
 * 命名和实现风格对齐 `require-auth.ts`（`declare global` 扩展 `Express.Request`、
 * 统一的错误响应格式），保持中间件写法一致（见 design.md 决策 2）。
 *
 * 实际的判断逻辑（Team OWNER 兜底 + WikiMember 查询）已提取到 `services/wiki-access.ts`
 * 的 `checkWikiAccess`——这里只负责把结果映射成 HTTP 语义，逻辑本身与 gRPC 的
 * `AccessControlService.CheckDocumentRole`（见 yjs-realtime-collaboration design.md
 * 决策 2）共用同一份实现，不重复维护。
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

    const access = await checkWikiAccess(wikiId, userId);
    if (!access.granted) {
      res.status(access.reason === 'not_found' ? 404 : 403).json({error: access.reason});
      return;
    }

    if (WIKI_ROLE_WEIGHT[access.role] < WIKI_ROLE_WEIGHT[minRole]) {
      res.status(403).json({error: 'forbidden'});
      return;
    }

    req.wikiRole = access.role;
    next();
  };
}
