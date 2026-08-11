import {prisma} from '../db/prisma';
import {Prisma, type Wiki, type WikiMember, type WikiRole} from '../generated/prisma/client';
import {findUserById} from '../models/user';
import {
  deleteWiki as deleteWikiModel,
  findWikiById,
  listWikisByUserId,
  updateWikiInfo as updateWikiInfoModel,
  updateWikiOwner
} from '../models/wiki';
import {
  countOwners,
  createWikiMember,
  deleteWikiMember,
  findAnyOtherOwner,
  findWikiMember,
  listWikiMembers as listWikiMembersModel,
  updateWikiMemberRole as updateWikiMemberRoleModel,
  type WikiMemberWithUser
} from '../models/wiki-member';
import {buildDicebearUrl} from '../utils/dicebear';

/** 风格对齐 services/auth.ts 的 AuthError：status + message，handler 层统一映射成 HTTP 状态码 */
export class WikiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'WikiError';
    this.status = status;
  }
}

export interface CreateWikiInput {
  name: string;
  description?: string;
  coverImage?: string;
}

/**
 * 创建工作区：用事务原子性地同时创建 Wiki + role: OWNER 的 WikiMember 记录，
 * 保证创建者不需要任何额外操作就获得完整权限（见 design.md 决策 1、spec.md「创建工作区」）。
 * 未传 coverImage 时用按名称生成的默认封面兜底，不阻塞创建流程。
 */
export async function createWiki(userId: string, input: CreateWikiInput): Promise<Wiki> {
  const coverImage = input.coverImage ?? buildDicebearUrl('shapes', input.name);
  return prisma.$transaction(async tx => {
    const wiki = await tx.wiki.create({
      data: {ownerId: userId, name: input.name, description: input.description, coverImage}
    });
    await tx.wikiMember.create({data: {wikiId: wiki.id, userId, role: 'OWNER'}});
    return wiki;
  });
}

/** 只返回当前用户是成员的工作区，按更新时间倒序（见 design.md 决策 3） */
export function listMyWikis(userId: string): Promise<Wiki[]> {
  return listWikisByUserId(userId);
}

/** 详情查询：工作区存在性 + 当前用户角色已由 requireWikiRole 中间件前置校验过，这里直接查 */
export function getWiki(wikiId: string): Promise<Wiki | null> {
  return findWikiById(wikiId);
}

export interface UpdateWikiInfoInput {
  name?: string;
  description?: string;
  coverImage?: string;
}

/** 权限已由 requireWikiRole 中间件前置校验，这里是纯数据操作，不重复判断角色 */
export function updateWikiInfo(wikiId: string, data: UpdateWikiInfoInput): Promise<Wiki> {
  return updateWikiInfoModel(wikiId, data);
}

/** WikiMember 记录随 Wiki 一起级联删除（schema 的 onDelete: Cascade），这里不需要手动清理 */
export function deleteWiki(wikiId: string): Promise<Wiki> {
  return deleteWikiModel(wikiId);
}

export function listWikiMembers(wikiId: string): Promise<WikiMemberWithUser[]> {
  return listWikiMembersModel(wikiId);
}

/**
 * 添加成员：是否已是成员的唯一性判断完全交给数据库的 `@@unique([wikiId, userId])` 约束，
 * 不再"先查询、再写入"（那样在并发场景下有检查-执行间隙，见 wiki-workspace-fixes design.md
 * 决策 5）。命中唯一约束冲突（Prisma `P2002`）时转换成语义清晰的 `409`，其他数据库错误
 * 原样向上抛，交给上层的全局错误处理。
 */
export async function addWikiMember(
  wikiId: string,
  targetUserId: string,
  role: WikiRole
): Promise<WikiMember> {
  const targetUser = await findUserById(targetUserId);
  if (!targetUser) {
    throw new WikiError(404, 'user_not_found');
  }

  try {
    return await createWikiMember(wikiId, targetUserId, role);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new WikiError(409, 'already_member');
    }
    throw err;
  }
}

/**
 * 如果 `targetUserId` 恰好是当前 `Wiki.ownerId`，且这次操作后该用户不再持有 `OWNER` 角色，
 * 把 `ownerId` 重新指向另一个仍是 `OWNER` 的成员（按加入时间最早的那一个）——保证 `ownerId`
 * 任意时刻都指向一个现任 OWNER，不会变成陈旧引用（见 design.md 决策 3、spec.md「工作区拥有者
 * 引用与实际 OWNER 保持一致」）。必须在调用方所在的同一个事务（tx）内执行，与角色变更/成员
 * 移除具备原子性。找不到其他 OWNER 属于防御性分支——正常流程下 `assertNotRemovingLastOwner`
 * 已经会提前拒绝这类请求，不会真的走到"最后一个 OWNER 被拿走、又找不到人接手"这一步。
 */
async function syncWikiOwnerIfNeeded(
  tx: Prisma.TransactionClient,
  wikiId: string,
  targetUserId: string
): Promise<void> {
  const wiki = await findWikiById(wikiId, tx);
  if (!wiki || wiki.ownerId !== targetUserId) return;

  const anotherOwner = await findAnyOtherOwner(wikiId, targetUserId, tx);
  if (anotherOwner) {
    await updateWikiOwner(wikiId, anotherOwner.userId, tx);
  }
}

/**
 * 变更/移除前先检查"最后一个 OWNER"边界（见 design.md 决策 4、spec.md「工作区至少保留一个 OWNER」）：
 * 如果操作对象本身就是 OWNER，且当前工作区只有这一个 OWNER，无论是移除还是降级为非 OWNER 角色，
 * 都会导致工作区没有任何 OWNER，统一拒绝并返回 409。查询和后续的实际写入现在共享调用方传入的
 * 同一个事务客户端（tx），把"两个并发请求各自读到过期的 OWNER 数量、同时通过检查"这个竟态窗口，
 * 从"两次完整 HTTP 请求耗时"收窄到"一个事务内部的极短窗口"。
 */
async function assertNotRemovingLastOwner(
  tx: Prisma.TransactionClient,
  wikiId: string,
  targetUserId: string,
  nextRoleIfDemoting: WikiRole | null
): Promise<void> {
  const target = await findWikiMember(wikiId, targetUserId, tx);
  if (target?.role !== 'OWNER') return;
  if (nextRoleIfDemoting === 'OWNER') return;

  const ownerCount = await countOwners(wikiId, tx);
  if (ownerCount <= 1) {
    throw new WikiError(409, 'last_owner_required');
  }
}

export async function updateWikiMemberRole(
  wikiId: string,
  targetUserId: string,
  role: WikiRole
): Promise<WikiMember> {
  return prisma.$transaction(async tx => {
    await assertNotRemovingLastOwner(tx, wikiId, targetUserId, role);
    const updated = await updateWikiMemberRoleModel(wikiId, targetUserId, role, tx);
    // 只有"降级为非 OWNER"才可能需要把 ownerId 挪走；升级/保持 OWNER 不影响 ownerId
    if (role !== 'OWNER') {
      await syncWikiOwnerIfNeeded(tx, wikiId, targetUserId);
    }
    return updated;
  });
}

export async function removeWikiMember(wikiId: string, targetUserId: string): Promise<WikiMember> {
  return prisma.$transaction(async tx => {
    await assertNotRemovingLastOwner(tx, wikiId, targetUserId, null);
    const removed = await deleteWikiMember(wikiId, targetUserId, tx);
    // 成员被整条删除，必然不再是 OWNER，直接尝试同步（内部会先判断是否真的是 ownerId 对应的用户）
    await syncWikiOwnerIfNeeded(tx, wikiId, targetUserId);
    return removed;
  });
}
