## Context

`requireAuth` 中间件已经跑通（`api-auth-middleware` change），任何受保护接口都能拿到 `req.user.id`。Prisma schema 目前只有 `User`/`UserProfile`，没有任何业务数据表。前端 `home-workspace-shell` 的 Sidebar/`WikiList.tsx`/`WikiDetail.tsx` 已经搭好骨架，等着接真实数据（但本轮不接，纯后端）。

这一轮要把"工作区可以被分享"这件事的权限模型一次性定下来：不是简单的 `ownerId` 字段判断，而是引入 `WikiMember` 关联表 + 角色（`OWNER/EDITOR/VIEWER`），并在接口层就做差异化校验——即使目前唯一能产生 member 记录的方式只有"创建者自动成为 OWNER"，也要把 EDITOR/VIEWER 的读写边界在这一轮里定义清楚，避免以后真正做"邀请协作者"时再回来重构权限判断逻辑。

## Goals / Non-Goals

**Goals:**
- 定义 `Wiki` + `WikiMember` 的表结构和角色枚举
- 实现基于角色的权限中间件，供 Wiki 相关路由复用
- 实现 Wiki 的增删改查接口（列表只返回"我是成员"的工作区）
- 实现工作区成员管理接口（列表、添加、变更角色、移除），角色判断已在此轮生效

**Non-Goals:**
- Document（文章）模型与接口——留给下一个 change
- 前端页面接入（`WikiList.tsx`/`WikiDetail.tsx` 仍渲染 `EmptyState`）——留给下一个 change
- 邀请链接/邮件邀请等交互——本轮只做"用 `userId` 直接添加已注册用户为成员"的最小接口，没有任何前端 UI
- Yjs 协同内容持久化——不涉及

## Decisions

**1. `WikiMember` 关联表 + 角色枚举，而不是 `Wiki.ownerId` 单字段判断权限**
- `Wiki` 表只存 `ownerId`（记录创建者，用于展示"创建者是谁"，不参与权限判断本身）；真正的权限判断统一走 `WikiMember` 表：创建 Wiki 时事务性地插入一条 `role: OWNER` 的成员记录
- 角色分三级，权重 `OWNER(3) > EDITOR(2) > VIEWER(1)`：
  - `VIEWER`：可查看工作区详情、成员列表
  - `EDITOR`：`VIEWER` 权限 + 可重命名工作区
  - `OWNER`：`EDITOR` 权限 + 可删除工作区、管理成员（增/删/改角色）
- 备选方案：只用 `ownerId` 判断"是不是我的"——最简单，但完全不支持分享，且后续加分享要整个推翻权限判断逻辑重写，不采用（这正是上一轮"方案 B"就决定要避免的）

**2. 新增 `requireWikiRole(minRole)` 中间件，挂在 `requireAuth` 之后**
- 从路由参数 `:wikiId` 读取目标工作区，查 `WikiMember` 表判断当前用户角色是否满足 `minRole`；不满足或没有成员记录（不是该工作区成员）统一返回 `403 forbidden`；工作区本身不存在返回 `404 not_found`
- 校验通过后把成员角色挂到 `req.wikiRole`，供下游 handler 判断更细的行为（如 `EDITOR` 能不能碰"删除"按钮）
- 命名和实现方式参考 `require-auth.ts` 的既有模式（`declare global` 扩展 `Express.Request`，统一错误响应格式），保持中间件风格一致
- 备选方案：在每个 handler 内部手写权限判断——每个接口都要重复"查成员表、比较角色"的逻辑，容易漏改某个接口，不采用

**3. 列表接口只返回"我是成员"的工作区，不是全站 Wiki 列表**
- `GET /wikis` 通过 `WikiMember` 反查当前用户所在的所有工作区（`JOIN` 或两步查询），而不是 `Wiki.findMany()` 返回所有人的工作区——这是最基本的数据隔离，避免用户看到不属于自己的工作区
- 排序：按 `WikiMember` 关联的 `Wiki.updatedAt` 倒序（最近更新的排前面），跟前端 Sidebar 未来展示"最近访问"的直觉一致

**4. 添加成员只支持按 `userId`，不做邮箱邀请/邀请链接**
- `POST /wikis/:wikiId/members` 请求体 `{ userId, role }`，`userId` 必须是已存在的 `User`；不存在返回 `404 user_not_found`；已是成员返回 `409 already_member`
- 这是刻意收窄的最小实现：验证角色权限判断逻辑本身没问题，但不做"邀请未注册用户"这类需要邮件/链接系统的复杂交互——等真的要做"邀请"功能时再单独开 change 补
- 备选方案：支持按 `email`/`username` 添加——只是多了一层查找逻辑，可以后续加，不阻塞这一轮，暂不做

**5. 保护"至少一个 OWNER"的边界情况**
- 移除成员或降级角色时，如果操作后该工作区将没有任何 `OWNER`（如唯一的 OWNER 把自己降级或移除自己），返回 `409 last_owner_required`，拒绝操作
- 备选方案：允许工作区没有 OWNER——会导致工作区变成没人能删除/管理成员的孤儿数据，不采用

**6. 错误处理复用 `AuthError` 的模式，新增同构的 `WikiError` 类**
- `services/wiki.ts` 内定义 `WikiError extends Error`（`status` + `message`），handler 层统一 `catch` 后映射成 HTTP 状态码，跟 `services/auth.ts` 的 `AuthError` 完全一致的写法，保持代码风格统一
- 备选方案：直接在 handler 里写裸的 `res.status(xxx).json(...)`——service 层逻辑和 HTTP 细节耦合在一起，不利于以后 Document 服务复用同一套模式，不采用

**7. 路由结构：`/wikis` 资源式路径，成员管理是子资源**
- `GET /wikis`、`POST /wikis`、`GET /wikis/:wikiId`、`PATCH /wikis/:wikiId`（重命名）、`DELETE /wikis/:wikiId`
- `GET /wikis/:wikiId/members`、`POST /wikis/:wikiId/members`、`PATCH /wikis/:wikiId/members/:userId`（改角色）、`DELETE /wikis/:wikiId/members/:userId`
- 跟现有 `/auth`、`/me` 的扁平风格保持一致的 RESTful 资源命名，方便下一轮 Document 接口沿用同样的路径习惯（如 `/wikis/:wikiId/documents`）

## Risks / Trade-offs

- **[风险] 角色差异化校验目前只有 OWNER 会真实存在**（因为没有邀请 UI，唯一能添加成员的方式是 `POST /wikis/:wikiId/members` 这个纯 API），实际验证 EDITOR/VIEWER 行为只能靠 curl 手动插入成员记录测试 → **缓解**：手动验证阶段会显式用 API 添加一个 EDITOR/VIEWER 测试账号，逐条验证角色边界，不依赖前端 UI
- **[风险] `requireWikiRole` 每次请求都查一次 `WikiMember` 表**，多一次数据库往返 → **缓解**：当前数据量级不需要缓存，先用最直接的实现；如果后续 Document 接口也要频繁查权限，可以在这轮之后再考虑按 `wikiId+userId` 做短 TTL 缓存
- **[权衡] 不做邀请链接/邮件邀请**，产品意义上"分享"功能还不完整 → 这是本轮刻意收窄的范围，符合"边定协议边开发"的节奏，先把角色模型和权限判断这个地基打好，交互留给后面
