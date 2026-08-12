import type {NextFunction, Request, Response} from 'express';
import type {TeamRole} from '../generated/prisma/client';
import {findTeamById} from '../models/team';
import {findTeamMember} from '../models/team-member';
import {isValidUuid} from '../utils/uuid';

declare global {
  namespace Express {
    interface Request {
      /** 由 requireTeamRole 中间件注入，仅在挂载了该中间件的路由上存在 */
      teamRole?: TeamRole;
    }
  }
}

/** 角色权重：OWNER 完全包含 MEMBER 权限（跟 requireWikiRole 的写法完全对齐） */
const ROLE_WEIGHT: Record<TeamRole, number> = {
  OWNER: 2,
  MEMBER: 1
};

/**
 * 基于角色的团队访问权限中间件，挂在 `requireAuth` 之后使用（依赖 `req.user.id`）。
 * 从 `req.params['teamId']` 读取目标团队，校验当前用户在该团队的角色是否达到 `minRole`：
 *
 * - 团队不存在 → `404 not_found`
 * - 当前用户不是该团队任何成员，或角色权重不够 → 统一 `403 forbidden`
 *   （不区分"不是成员"和"是成员但权限不够"，避免向非成员泄露团队成员结构）
 * - 校验通过 → 把角色挂到 `req.teamRole`，供下游 handler 做更细粒度的行为判断
 *
 * 实现风格直接对齐 `require-wiki-role.ts`，保持两套中间件写法一致。
 */
export function requireTeamRole(minRole: TeamRole) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const userId = req.user?.id;
    if (userId === undefined) {
      res.status(401).json({error: 'unauthorized'});
      return;
    }

    const teamId = req.params['teamId'];
    if (!teamId || !isValidUuid(teamId)) {
      res.status(404).json({error: 'not_found'});
      return;
    }

    const team = await findTeamById(teamId);
    if (!team) {
      res.status(404).json({error: 'not_found'});
      return;
    }

    const member = await findTeamMember(teamId, userId);
    if (!member || ROLE_WEIGHT[member.role] < ROLE_WEIGHT[minRole]) {
      res.status(403).json({error: 'forbidden'});
      return;
    }

    req.teamRole = member.role;
    next();
  };
}
