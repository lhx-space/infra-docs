## Context

现有 `Wiki`/`WikiMember` 模型已经跑通并验证过一轮并发安全加固（`wiki-workspace-fixes`）：角色三级（`OWNER`/`EDITOR`/`VIEWER`）、唯一 OWNER 保护、`ownerId` 同步、成员添加的唯一约束防重复，这些都是可靠的既有实现，本次设计要求**不推翻这套逻辑**，只在它上面叠加一层"人从哪来"的容器。

现状的核心痛点：添加 Wiki 成员必须精确输入对方用户名/邮箱（`user-lookup` 接口），体验差且用户记不住；没有"一群人共享多个 Wiki"的组织概念；没有分享链接、申请加入这类协作产品里的标准能力。

## Goals / Non-Goals

**Goals:**
- 引入 `Team` 作为轻量租户层，解决"添加成员靠记完整用户名"的体验问题
- 个人空间与团队空间统一为同一套模型（个人即团队），不引入模式切换
- Wiki 级别新增分享链接与申请加入两种协作机制，且严格限定在"同一 Team 内"
- 保持现有 `WikiMember`/角色/唯一 OWNER 保护逻辑不变，新逻辑只做叠加，不做替换

**Non-Goals:**
- **不做递归/嵌套子团队**（"团队下再有团队"）。理由：需要解决环检测、级联删除语义、权限继承方向（父子谁继承谁）等一系列复杂度，且目前没有具体场景需要它——一旦真的出现明确场景，大概率也只需要固定一层分组，不是无限递归，留给未来单独评估
- **不做"Team 内默认可见所有 Wiki 内容"**。Team 成员默认只能看到 Team 下 Wiki 的存在（元信息），不能看内容/成员名单，除非显式加入
- **不改动 `WikiRole`（`OWNER`/`EDITOR`/`VIEWER`）三级角色本身、唯一 OWNER 保护的事务实现细节**，这些在 `wiki-workspace-fixes` 里已经验证过，本次直接复用
- **不处理 `user-lookup` 接口的废弃**，只是不再被 Wiki 成员管理调用，接口本身保留现状

## Decisions

### 1. 个人即团队：注册时自动创建个人 Team，不做"个人/团队"两套模式

每个用户注册成功后，在同一事务内自动创建一个 `Team`（`isPersonal: true`），该用户是唯一成员且角色为 `OWNER`。用户建的所有 Wiki 都挂在某个 Team 下（默认是这个个人 Team）。

**备选方案**：先允许"Wiki 可以不属于任何 Team"，只有显式创建多人 Team 后才需要归属。**放弃**，因为这样会同时存在两套 Wiki（有主/无主），后续所有权限判断代码都要写两条分支，复杂度反而更高。统一"Wiki 必属于且仅属于一个 Team"，个人 Team 只是"只有一个成员的普通 Team"，不是特殊类型。

### 2. Team 角色只设 `OWNER`/`MEMBER`，不设 `ADMIN`

想不出"能管人但不能删团队"的具体场景，加了就是没人用的复杂度。以后有真实需求再加角色比现在减角色容易。

### 3. Team `OWNER` 对该 Team 下所有 Wiki 的默认权限，用运行时计算，不落库

权限判断顺序：先查"当前用户是不是该 Wiki 所属 Team 的 `OWNER`"，是则直接放行为 `OWNER`；不是则再查 `WikiMember` 表。

**备选方案**：Team `OWNER` 变更时同步写一条 `WikiMember`（`OWNER`）记录到该 Team 下所有 Wiki。**放弃**，因为这要求"Team OWNER 变化"这个事件必须联动更新它名下可能几十上百个 Wiki 的 `WikiMember` 记录，跟 `wiki-workspace-fixes` 里刚修过的 `Wiki.ownerId` 同步是同一类坑（一份数据两处存，必须保持一致），没必要重蹈覆辙。运行时计算只需要改造 `requireWikiRole` 中间件多一次查询，没有任何东西需要"保持同步"。

推论：这条运行时权限是**绝对优先**的，即使某个 Wiki 里存在一条把该用户设成较低角色（如 `VIEWER`）的显式 `WikiMember` 记录，判断时也不看那条记录，先判断 Team `OWNER` 身份直接放行——不能靠给团队所有者单独设一条低权限记录来限制他。

### 4. Wiki 添加成员收紧为"目标用户必须已是同 Team 成员"

`POST /wikis/:wikiId/members` 的 `userId` 校验新增一条：该用户必须已经是这个 Wiki 所属 `teamId` 的 `TeamMember`，否则返回 `404`（跟"用户不存在"用同一错误码，不额外暴露"用户存在但不在这个团队"这种细节）。原来的"精确查找任意已注册用户直接添加"路径整体去掉。

前端"添加成员"从"输入框查找"改为"下拉/列表勾选 Team 成员"。

### 5. Team 邀请链接：固定 `MEMBER` 角色，支持一次性或多次使用

`TeamInvite` 表存链接配置（`token`/`role`固定`MEMBER`/`maxUses`可空表示不限次数/`expiresAt`/`revokedAt`）；实际使用记录单独存一张 `TeamInviteRedemption`（`inviteId` + `userId` 唯一），理由：
- 同一个人重复点同一条链接需要幂等（直接跳转，不重复计数、不报错），需要能查"这个人是否已经用过这条链接"
- 多次使用的链接需要能数出"已经被用了几次"，塞在 `TeamInvite` 单个字段上（比如 `usedBy`）只够记一次

链接不允许直接生成 `OWNER`——链接一旦泄露不该等于泄露团队控制权；需要更高权限走"Team 内成员管理"页面手动提升角色。

### 6. Team 唯一 OWNER 保护：直接复用 Wiki 层已验证的事务模式

规则与实现方式跟 `wiki-workspace-fixes` 里 Wiki 层的"工作区至少保留一个 OWNER"完全一致（同一事务内完成"查角色→查 OWNER 数量→校验→写入"），这次从第一版就这么做，不再走"先上线再补 fixes"的路径。

### 7. 退出 Team 时，Wiki OWNER 的自动转移

成员离开（主动退出或被移除）Team 时，在同一事务内：
1. 删除该用户在这个 Team 下所有 Wiki 的 `WikiMember` 记录
2. 对其中"删除前该用户是这个 Wiki 唯一显式 `OWNER`"的 Wiki，`upsert` 一条 `WikiMember`（角色 `OWNER`）给当前 Team 里最早加入且仍持有 `OWNER` 角色的成员（复用 `findAnyOtherOwner` 的排序逻辑）

严格来说，即使不做这次转移，决策 3 的运行时兜底权限已经保证不会出现权限真空。做这次显式转移纯粹是为了 Wiki 成员列表的可读性——不然会出现"成员列表里没有任何 OWNER，但 Team OWNER 却神奇地能管理它"这种反直觉的展示。

### 8. Wiki 分享链接：角色不超过创建者，限定同 Team 内生效

`WikiShareLink` 记录创建者当时的角色上限，服务端在生成时校验"要授予的角色 ≤ 创建者当前角色"，拒绝越权。链接被不在该 Wiki 所属 Team 的人打开时，提示"需要先加入 XX 团队"，不允许绕过 Team 边界直接换取权限。

### 9. 申请加入机制：默认关闭、独立可见性接口、条件更新防并发

- `Wiki.allowJoinRequest` 默认 `false`，OWNER 需要显式开启，保证现有 Wiki 无损升级
- Team 成员浏览"这个 Team 有哪些 Wiki"走**新接口** `GET /teams/:teamId/wikis`，只返回元信息（名称/简介/封面/是否已是成员/是否可申请），不包含文档内容或成员名单；现有 `GET /wikis`（只返回我已加入的）保持不变，两个接口不合并，避免混改出安全回归
- `WikiJoinRequest` 每个 `(wikiId, userId)` 只保留一条记录（`status` 在 `PENDING`/`APPROVED`/`REJECTED` 间流转，被拒绝后再申请是更新同一行，不追加历史行），审批用条件更新（`WHERE status = 'PENDING'`）保证两个 OWNER 同时处理同一条申请时不会互相覆盖
- 被拒绝后允许再次申请，但有冷却时间（默认 24 小时，可调）

## Risks / Trade-offs

- **[风险] 运行时计算 Team OWNER 权限，每次 Wiki 权限判断多一次数据库查询** → 权衡可接受：换来的是零同步逻辑，且 Team 成员表大概率远小于需要频繁查询的量级，先不加缓存，真的成为瓶颈再考虑加一层短 TTL 缓存
- **[风险] Wiki 添加成员收紧为"必须同 Team"是一次破坏性收紧** → 通过下面的迁移计划保证历史数据在收紧后依然自洽，不会出现"现有成员一夜之间不满足新规则"的情况
- **[风险] 邀请链接支持多次使用，理论上被大量分发后可能被滥用拉入大量陌生人** → 生成时提供"限定次数"选项，且所有 Team 都能随时手动失效链接，作为止损手段，不做更复杂的风控（超出本次范围）
- **[Trade-off] 分开 `GET /wikis` 和 `GET /teams/:teamId/wikis` 两个接口，而不是给现有接口加参数区分** → 多一个接口维护成本，换来的是现有已验证的"非成员不可见"行为完全不用动，回归风险降到最低

## Migration Plan

1. 新增六张表（`Team`/`TeamMember`/`TeamInvite`/`TeamInviteRedemption`/`WikiShareLink`/`WikiJoinRequest`）及 `Wiki.teamId`（先允许为空）、`Wiki.allowJoinRequest`（默认 `false`）的 Prisma migration
2. 数据回填脚本（一次性，事务内执行）：
   a. 为每个现有 `User` 创建一个 `Team`（`isPersonal: true`），该用户为 `OWNER`
   b. 为每个现有 `Wiki`，将 `teamId` 回填为其 `ownerId` 对应用户的个人 Team
   c. **关键一步**：对每个现有 `Wiki`，把它现有 `WikiMember` 列表里除创建者外的其他成员（`EDITOR`/`VIEWER`），也一并作为 `MEMBER` 加入该 Wiki 所属的（创建者）个人 Team——否则收紧后的新规则（"加成员前必须先是同 Team 成员"）会让这些历史数据显得不自洽（虽然新规则只影响"新增"操作，不会反向踢人，但让存量数据在语义上说得通更安全）
3. 回填完成后，将 `Wiki.teamId` 改为必填（第二次 migration）
4. 应用层改造（`requireWikiRole` 中间件、`addWikiMember` 校验、前端添加成员 UI）随迁移之后上线，不需要停机，Team 相关新功能（邀请链接/分享/申请）上线后即可用，不影响存量 Wiki 的现有访问

**回滚策略**：由于 `teamId` 第一阶段允许为空，如果迁移中途出问题，可以先回滚应用层代码（继续用旧的精确查找逻辑，忽略 `teamId`），数据库改动本身不影响现有查询路径，不需要立即回滚 schema。

## Open Questions

- 邀请链接默认要不要有一个"次数上限"的默认值（比如不填默认 50 次），还是完全放开交给创建者自己填？
- "申请加入被拒绝后的冷却时间"具体定多久合适（design 里先写 24 小时，需要确认）
- Wiki 从一个 Team 转移到另一个 Team 时，原 Team 里那些不在新 Team 的现有 `WikiMember` 要不要走跟"迁移"类似的自动补票逻辑，还是直接按之前讨论的"立刻失去访问权"处理？（当前倾向后者——转移是主动操作，跟"帮历史数据兜底"的迁移语义不同，但需要在实现前明确写进对应 change 的 spec 里）
