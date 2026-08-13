import {prisma} from '../db/prisma';
import {Prisma, type Wiki, type WikiMember, type WikiRole} from '../generated/prisma/client';
import {findPersonalTeam} from '../models/team';
import {findTeamMember} from '../models/team-member';
import {findUserById} from '../models/user';
import {
  deleteWiki as deleteWikiModel,
  findWikiById,
  listWikisByUserId,
  updateWikiInfo as updateWikiInfoModel,
  updateWikiOwner,
  updateWikiTeam
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
import {releaseImageRef} from './storage';

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
  /** 归属的 Team；不传时默认取创建者的个人 Team（见 team-workspace-model spec.md「工作区归属团队」） */
  teamId?: string;
}

/**
 * 创建工作区：用事务原子性地同时创建 Wiki + role: OWNER 的 WikiMember 记录，
 * 保证创建者不需要任何额外操作就获得完整权限（见 design.md 决策 1、spec.md「创建工作区」）。
 * 未传 coverImage 时用按名称生成的默认封面兜底，不阻塞创建流程；显式指定 teamId 时
 * 必须校验创建者本身是该 Team 的成员，不能凭空把 Wiki 挂到自己不属于的团队下。
 */
export async function createWiki(userId: string, input: CreateWikiInput): Promise<Wiki> {
  const coverImage = input.coverImage ?? buildDicebearUrl('shapes', input.name);

  let teamId = input.teamId;
  if (teamId) {
    const membership = await findTeamMember(teamId, userId);
    if (!membership) {
      throw new WikiError(403, 'not_team_member');
    }
  } else {
    const personalTeam = await findPersonalTeam(userId);
    if (!personalTeam) {
      // 防御性分支：注册流程已经保证每个用户都有个人 Team，正常不会走到这里
      throw new WikiError(500, 'personal_team_not_found');
    }
    teamId = personalTeam.id;
  }

  return prisma.$transaction(async tx => {
    const wiki = await tx.wiki.create({
      data: {
        ownerId: userId,
        teamId: teamId as string,
        name: input.name,
        description: input.description,
        coverImage
      }
    });
    await tx.wikiMember.create({data: {wikiId: wiki.id, userId, role: 'OWNER'}});
    return wiki;
  });
}

/**
 * 转移工作区归属的 Team：仅调用方需在 handler 层校验是该 Wiki 的 OWNER（复用 requireWikiRole）；
 * 这里额外校验操作者本身是目标 Team 的成员，防止把 Wiki 转移到自己不属于的团队。转移后不在
 * 新 Team 的原有 WikiMember 立即失效，靠权限判断的运行时计算体现，不需要主动清理记录
 * （见 design.md 决策 1、spec.md「工作区归属团队」）。
 */
export async function transferWikiTeam(
  wikiId: string,
  newTeamId: string,
  userId: string
): Promise<Wiki> {
  const membership = await findTeamMember(newTeamId, userId);
  if (!membership) {
    throw new WikiError(403, 'not_team_member');
  }
  return updateWikiTeam(wikiId, newTeamId);
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
  /** OWNER 显式开启才允许团队成员申请加入，见 team-workspace-model spec.md「工作区申请加入开关」 */
  allowJoinRequest?: boolean;
}

/**
 * 权限已由 requireWikiRole 中间件前置校验，这里是纯数据操作，不重复判断角色。
 * `coverImage` 变更时，先读出旧值再写入，写入成功后若旧值非空且与新值不同，释放该图片
 * 的一次引用（见 image-upload-dedup design.md 决策 4）——不改变 `coverImage` 字段时
 * （`data.coverImage === undefined`）不需要多查一次 Wiki，直接走原有的单次更新。
 */
export async function updateWikiInfo(wikiId: string, data: UpdateWikiInfoInput): Promise<Wiki> {
  if (data.coverImage === undefined) {
    return updateWikiInfoModel(wikiId, data);
  }

  const existing = await findWikiById(wikiId);
  const updated = await updateWikiInfoModel(wikiId, data);
  if (existing?.coverImage && existing.coverImage !== data.coverImage) {
    await releaseImageRef(existing.coverImage);
  }
  return updated;
}

/**
 * WikiMember 记录随 Wiki 一起级联删除（schema 的 onDelete: Cascade），这里不需要手动清理。
 * 删除前读出 `coverImage`，删除成功后若其非空，释放该图片的一次引用
 * （见 image-upload-dedup design.md 决策 4）。
 */
export async function deleteWiki(wikiId: string): Promise<Wiki> {
  const existing = await findWikiById(wikiId);
  const deleted = await deleteWikiModel(wikiId);
  if (existing?.coverImage) {
    await releaseImageRef(existing.coverImage);
  }
  return deleted;
}

export function listWikiMembers(wikiId: string): Promise<WikiMemberWithUser[]> {
  return listWikiMembersModel(wikiId);
}

/**
 * 添加成员：目标用户必须已经是该 Wiki 所属 Team 的成员，不再支持对任意已注册用户精确
 * 查找后直接添加（**BREAKING**，见 team-workspace-model design.md 决策 4、spec.md
 * 「工作区成员管理」）。是否已是成员的唯一性判断完全交给数据库的 `@@unique([wikiId, userId])`
 * 约束，不再"先查询、再写入"（那样在并发场景下有检查-执行间隙，见 wiki-workspace-fixes
 * design.md 决策 5）。命中唯一约束冲突（Prisma `P2002`）时转换成语义清晰的 `409`，其他
 * 数据库错误原样向上抛，交给上层的全局错误处理。
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

  const wiki = await findWikiById(wikiId);
  if (!wiki) {
    throw new WikiError(404, 'not_found');
  }

  const teamMembership = await findTeamMember(wiki.teamId, targetUserId);
  if (!teamMembership) {
    // 不额外区分"用户存在但不在团队"和"用户不存在"，避免向 OWNER 泄露该用户是否真实存在
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

/**
 * 团队成员退出/被移除时，若其是某个 Wiki 唯一显式的 `OWNER`，由调用方（services/team.ts）
 * 在同一事务内把该 Wiki 的 `OWNER` 转移给指定的接收人（当前 Team 中最早加入且仍持有 `OWNER`
 * 的成员）；这里只负责"确保 toUserId 拥有一条 OWNER 的 WikiMember 记录 + 同步 ownerId"，
 * 不负责删除原 OWNER 的记录——那一步由调用方跟"清理该用户在整个 Team 下所有 WikiMember"
 * 的批量操作一起做（见 team-workspace-model design.md 决策 7）。
 */
export async function transferSoleWikiOwnership(
  tx: Prisma.TransactionClient,
  wikiId: string,
  toUserId: string
): Promise<void> {
  const existing = await findWikiMember(wikiId, toUserId, tx);
  if (existing) {
    await updateWikiMemberRoleModel(wikiId, toUserId, 'OWNER', tx);
  } else {
    await createWikiMember(wikiId, toUserId, 'OWNER', tx);
  }
  await updateWikiOwner(wikiId, toUserId, tx);
}
