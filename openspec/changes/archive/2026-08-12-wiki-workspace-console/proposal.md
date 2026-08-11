## Why

后端 `wiki-workspace-api` 已经实现并 curl 验证通过（建表、角色权限、成员管理全部跑通），但前端 `WikiList.tsx`/`WikiDetail.tsx` 目前仍渲染 `EmptyState`，Sidebar 的 Pin 列表也只是把原始 id 当文字显示——真实数据接不进去，整个 Wiki 功能对用户来说等于不存在。

接入这批数据时，会暴露两个后端目前还没有覆盖的缺口：
1. 添加工作区成员的现有接口只接受精确的 `userId`（UUID），前端没有任何"输入用户名/邮箱找到这个人"的方式，UI 没法用
2. Wiki 卡片按产品预期要展示封面图，但项目里完全没有文件上传/对象存储能力

这次把前端接入这两个缺口一起补上，形成一个用户可感知的完整闭环：能创建 Wiki、能看到带封面图的卡片列表、能管理成员和分享权限、能置顶。

## What Changes

- **`WikiList` 页面重写**：Card 网格展示我拥有/被分享的 Wiki（封面图 + 名称 + 简介），支持创建（名称必填、简介可选、封面图可选上传，不上传时用生成的默认封面兜底，同头像默认值的思路）
- **卡片交互**：hover 卡片出现一个"设置"入口（不影响点击卡片主体进入 Wiki 详情页的默认导航行为）；同时提供 Pin/取消 Pin 的入口
- **设置面板**（点击设置入口打开，Dialog 形式）：
  - *Basic Information*：改名、改简介、更换封面图、删除工作区（仅 `OWNER`，需二次确认）
  - *Members*：成员列表（含角色）、按用户名/邮箱精确查找并添加成员、变更成员角色、移除成员——这就是"分享的权限管控"，直接复用后端已有的角色体系，不新增权限模型
  - 面板内的操作按钮根据当前用户在该 Wiki 的角色（`OWNER`/`EDITOR`/`VIEWER`）动态启用/禁用，跟后端权限一一对应，不允许 UI 显示出实际会被后端拒绝的操作
- **Sidebar Pin 列表**：改成展示真实 Wiki 名称（目前是裸 id），需要能从某个全局可访问的 Wiki 列表里解析出 id → 名称的映射
- **新增前端状态层**：`store/wiki.ts`（Wiki 列表 + CRUD + 成员管理 actions）+ `services/wiki.ts`（对 `/wikis` 系列接口的薄封装），组件不直接 import services，遵循既有约定
- **新增后端：按标识符精确查找用户**（`GET /users/lookup?identifier=`，复用登录时"邮箱或用户名"的判断方式），仅用于"添加成员"场景，不做模糊搜索、不做用户名录/全站可枚举查询
- **新增后端：文件上传能力**（新的、独立于 Wiki 的通用能力）：`docker-compose.yml` 新增 `minio` 服务；后端新增上传接口，图片写入 MinIO 对象存储，返回可直接展示的 URL
- **`Wiki` Prisma 模型补字段**：新增可选的 `description`、`coverImage` 字段（不影响已有的 `id/name/ownerId` 契约）

## Capabilities

### New Capabilities
- `wiki-workspace-console`：Wiki 列表页的创建、卡片展示、hover 设置入口、Pin、通过设置面板管理 Basic Information / Members（分享权限）的前端交互契约
- `user-lookup`：按用户名或邮箱精确查找单个已注册用户的后端能力（用于"添加成员"等场景，不做模糊搜索/全站枚举）
- `file-upload`：基于 MinIO 的通用图片上传能力（当前唯一消费方是 Wiki 封面图，但接口设计不绑定 Wiki 这一个场景）

### Modified Capabilities
（无——不改动 `wiki-workspace-api` change 里已定义的 Wiki CRUD/角色权限契约，本轮是新增消费方和两个独立的辅助能力；`Wiki` 模型新增的 `description`/`coverImage` 是纯新增可选字段，不改变已有字段的行为）

## Impact

- **数据库**：`Wiki` 表新增 `description`（可选）、`coverImage`（可选）两列，需要一次新的 Prisma migration
- **新增基础设施依赖**：`docker-compose.yml` 新增 `minio` 服务（`minio/minio:latest`），后端新增 MinIO 客户端 SDK 依赖 + multipart 解析依赖
- **受影响代码（后端）**：`apps/api/src/models/wiki.ts`（补字段读写）、新增 `apps/api/src/services/storage.ts`（MinIO 封装）、新增上传 handler/route、新增用户查找 handler/route、`apps/api/prisma/schema.prisma`
- **受影响代码（前端）**：`apps/web/src/pages/wiki/WikiList.tsx` 整体重写、新增 `store/wiki.ts`/`services/wiki.ts`、`apps/web/src/components/shell/Sidebar.tsx`（Pin 列表渲染逻辑）、新增 Wiki 相关 UI 组件（卡片、创建/设置 Dialog）
- **不影响**：`WikiDetail.tsx`（文章列表，仍是下一个 change 的范围）、`auth`/`user-profile-menu` 现有能力、`wiki-workspace-api` 已经上线的 CRUD/权限判断逻辑本身
