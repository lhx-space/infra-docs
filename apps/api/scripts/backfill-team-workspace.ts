/**
 * 一次性数据回填脚本（team-workspace-model tasks 1.5~1.7）：
 * 1. 为每个还没有个人 Team 的 User 创建一个（isPersonal: true，该用户 OWNER）
 * 2. 为每个还没有 teamId 的 Wiki，回填为创建者（ownerId）的个人 Team
 * 3. 为每个 Wiki 的非创建者 WikiMember，一并加入该 Wiki 所属 Team（角色 MEMBER），
 *    保证历史数据满足"添加成员前必须先是同 Team 成员"的新规则（见 design.md 决策 4 与 Migration Plan）
 *
 * 全程按"已存在则跳过"实现，重复执行是幂等的，可以安全地多次运行（见 tasks.md 1.8）。
 *
 * 用法：cd apps/api && npx tsx --env-file=.env scripts/backfill-team-workspace.ts
 */
import {prisma} from '../src/db/prisma';

async function ensurePersonalTeam(userId: string): Promise<string> {
  const existing = await prisma.team.findFirst({
    where: {isPersonal: true, members: {some: {userId}}}
  });
  if (existing) return existing.id;

  const team = await prisma.$transaction(async tx => {
    const created = await tx.team.create({data: {name: '我的空间', isPersonal: true}});
    await tx.teamMember.create({data: {teamId: created.id, userId, role: 'OWNER'}});
    return created;
  });
  return team.id;
}

async function backfillPersonalTeams(): Promise<Map<string, string>> {
  const users = await prisma.user.findMany({select: {id: true}});
  const userIdToTeamId = new Map<string, string>();
  for (const user of users) {
    const teamId = await ensurePersonalTeam(user.id);
    userIdToTeamId.set(user.id, teamId);
  }
  console.log(`✓ 个人 Team 回填完成，涉及 ${users.length} 个用户`);
  return userIdToTeamId;
}

async function backfillWikiTeamId(userIdToTeamId: Map<string, string>): Promise<void> {
  const wikis = await prisma.wiki.findMany({
    where: {teamId: null},
    select: {id: true, ownerId: true}
  });

  for (const wiki of wikis) {
    const teamId = userIdToTeamId.get(wiki.ownerId);
    if (!teamId) {
      console.warn(`跳过 Wiki ${wiki.id}：找不到 owner ${wiki.ownerId} 对应的个人 Team`);
      continue;
    }
    await prisma.wiki.update({where: {id: wiki.id}, data: {teamId}});
  }
  console.log(`✓ Wiki.teamId 回填完成，涉及 ${wikis.length} 个工作区`);
}

async function backfillHistoricalMembersIntoTeam(): Promise<void> {
  const wikis = await prisma.wiki.findMany({
    where: {teamId: {not: null}},
    select: {
      id: true,
      teamId: true,
      ownerId: true,
      members: {select: {userId: true}}
    }
  });

  let addedCount = 0;
  for (const wiki of wikis) {
    if (!wiki.teamId) continue;
    for (const member of wiki.members) {
      if (member.userId === wiki.ownerId) continue; // 创建者已经在自己的个人 Team 里

      const existing = await prisma.teamMember.findUnique({
        where: {teamId_userId: {teamId: wiki.teamId, userId: member.userId}}
      });
      if (existing) continue;

      await prisma.teamMember.create({
        data: {teamId: wiki.teamId, userId: member.userId, role: 'MEMBER'}
      });
      addedCount += 1;
    }
  }
  console.log(`✓ 历史工作区成员回填完成，新增 ${addedCount} 条团队成员记录`);
}

async function main(): Promise<void> {
  const userIdToTeamId = await backfillPersonalTeams();
  await backfillWikiTeamId(userIdToTeamId);
  await backfillHistoricalMembersIntoTeam();
  console.log('全部回填完成。');
}

main()
  .catch(err => {
    console.error('回填失败：', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
