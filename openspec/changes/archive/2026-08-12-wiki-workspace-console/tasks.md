## 1. 基础设施：MinIO

- [x] 1.1 在 `docker-compose.yml` 新增 `minio` 服务（`minio/minio:latest`，`server /data --console-address ":9001"`，端口 9000/9001，`.data/minio` 持久化卷，healthcheck）
- [x] 1.2 在 `apps/api/.env`/`.env.example` 新增 `MINIO_ENDPOINT`/`MINIO_PORT`/`MINIO_ROOT_USER`/`MINIO_ROOT_PASSWORD`/`MINIO_PUBLIC_URL`（内部连接地址与外部可访问地址分开，后者用于拼公开 URL）
- [x] 1.3 `pnpm --filter api add minio multer sharp` + `pnpm --filter api add -D @types/multer`

## 2. 后端：文件上传能力（`file-upload`）

- [x] 2.1 创建 `apps/api/src/services/storage.ts`：初始化 MinIO Client，启动时确保 `covers` bucket 存在（不存在则创建）并设置 bucket policy 为 public-read
- [x] 2.2 实现 `uploadImage(buffer, mimeType): Promise<{ url: string }>`：先用 `sharp` 转码为 WebP 并将最长边缩放到不超过 1600px，再生成唯一 object key（如 `uuid.webp`）写入 MinIO，拼接 `MINIO_PUBLIC_URL` 返回可公开访问的 URL
- [x] 2.3 创建 `apps/api/src/handlers/upload.ts`：`uploadImageHandler`，用 `multer` 内存存储解析单文件字段 `file`，校验 MIME 类型（`image/*`）返回 `400 invalid_file_type`、大小上限 5MB 返回 `400 file_too_large`，通过后调用 `uploadImage`
- [x] 2.4 创建 `apps/api/src/routes/upload.ts`：`POST /uploads/images` 挂 `requireAuth` + multer 中间件 + handler，在 `routes/index.ts` 挂载

## 3. 后端：按标识符查找用户（`user-lookup`）

- [x] 3.1 在 `apps/api/src/models/user.ts` 复用现有 `findUserByEmail`/`findUserByUsername`（无需新增 model 函数）
- [x] 3.2 创建 `apps/api/src/handlers/user.ts` 新增 `lookupUserHandler`：`identifier` 含 `@` 走邮箱查找否则走用户名查找，找到返回 `{ id, username, avatarUrl }`（不含 email），未找到返回 `404 user_not_found`
- [x] 3.3 在 `apps/api/src/routes/user.ts` 新增 `GET /users/lookup` 挂 `requireAuth`

## 4. 后端：`Wiki` 模型补字段

- [x] 4.1 `apps/api/prisma/schema.prisma` 的 `Wiki` 模型新增可选字段 `description String?`、`coverImage String?`
- [x] 4.2 运行 `npx prisma migrate dev --name add_wiki_description_and_cover` 生成迁移
- [x] 4.3 更新 `apps/api/src/models/wiki.ts`：`createWiki`/`updateWikiName` 相关函数支持读写 `description`/`coverImage`（新增 `updateWikiInfo` 或扩展现有函数签名）
- [x] 4.4 更新 `apps/api/src/services/wiki.ts` 的 `createWiki`：未传 `coverImage` 时，用按名称生成的默认封面 URL 兜底（对齐 `buildDefaultAvatarUrl` 的写法，放一个 `buildDefaultCoverUrl(name)`）
- [x] 4.5 更新 `apps/api/src/handlers/wiki.ts`：`createWikiSchema`/新增 `updateWikiInfoSchema` 用 zod 校验 `description`（可选，长度上限）、`coverImage`（可选，URL 格式）

## 5. 前端：状态层

- [x] 5.1 创建 `apps/web/src/services/wiki.ts`：对 `/wikis` 系列接口的薄封装（`listWikis`/`createWiki`/`getWiki`/`updateWikiInfo`/`deleteWiki`/`listMembers`/`addMember`/`updateMemberRole`/`removeMember`），风格对齐 `services/user.ts`
- [x] 5.2 创建 `apps/web/src/services/upload.ts`：`uploadImage(file: File): Promise<{ url: string }>`，用 `FormData` 提交
- [x] 5.3 在 `apps/web/src/services/user.ts` 新增 `lookupUser(identifier: string)`
- [x] 5.4 创建 `apps/web/src/store/wiki.ts`：`wikis` 列表 + `fetchWikis`/`createWiki`/`updateWikiInfo`/`deleteWiki` 等 actions，组件只通过这个 store 触发请求（遵循既有约定）

## 6. 前端：Wiki 列表页

- [x] 6.1 创建 `apps/web/src/components/wiki/WikiCard.tsx`：展示封面图/名称，hover 显示设置图标 + pin 图标，点击卡片主体导航到 `/wiki/:wikiId`，点击设置图标打开管理面板（不触发导航）
- [x] 6.2 创建 `apps/web/src/components/wiki/CreateWikiDialog.tsx`：名称（必填）、简介（可选）、封面图上传（可选，调用 `uploadImage`）表单
- [x] 6.3 重写 `apps/web/src/pages/wiki/WikiList.tsx`：挂载时通过 `store/wiki.ts` 拉取列表，Card 网格布局渲染 `WikiCard`，提供"新建 Wiki"入口打开 `CreateWikiDialog`，空列表时仍展示 `EmptyState`

## 7. 前端：Wiki 设置面板

- [x] 7.1 创建 `apps/web/src/components/wiki/WikiSettingsDialog.tsx`：Dialog + 两个 Tab（Basic Information / Members），接收 `wikiId` 和当前用户角色
- [x] 7.2 Basic Information Tab：改名/改简介/换封面图表单，删除工作区按钮（仅 `OWNER` 可见，二次确认用现有 `Dialog` 组件或简单的 `confirm` 交互）；`EDITOR` 可编辑基本信息但看不到删除按钮，`VIEWER` 全部只读
- [x] 7.3 Members Tab：成员列表（用户名 + 角色），仅 `OWNER` 可见"查找并添加成员"输入框（调用 `lookupUser` 找到后再调用 `addMember`）、角色下拉修改、移除按钮；查找不到用户时给出文案提示，不发起添加请求
- [x] 7.4 按钮可用状态统一由传入的 `role` 参数计算（`OWNER`/`EDITOR`/`VIEWER` 三档），不在每个子组件里各自判断一遍

## 8. 前端：Pin 与 Sidebar

- [x] 8.1 `apps/web/src/components/shell/Sidebar.tsx`：从 `store/wiki.ts` 读取列表（挂载时若列表为空触发一次拉取，避免和 `WikiList` 页面重复请求），把 `pinnedWikiIds` 映射成真实名称展示，找不到时兜底显示原始 id
- [x] 8.2 `WikiCard.tsx` 的 pin 图标接入 `usePinnedStore.togglePinWiki`，展示当前 pin 状态（图标高亮）

## 9. 验证

- [x] 9.1 `docker-compose up minio -d` 后确认 MinIO 控制台可访问，`covers` bucket 已自动创建且策略为 public-read
- [x] 9.2 `pnpm --filter api typecheck` + `pnpm --filter web typecheck`，确保无类型错误
- [x] 9.3 curl 验证：上传一张图片 → 返回 URL 以 `.webp` 结尾 → 不带任何鉴权头直接访问该 URL 能拿到图片内容且格式为 WebP
- [x] 9.3b curl 验证：上传一张长边超过 1600px 的大图 → 存储后的文件尺寸被等比缩放到 1600px 以内
- [x] 9.4 curl 验证：上传非图片文件返回 `400 invalid_file_type`；上传超过 5MB 的图片返回 `400 file_too_large`
- [x] 9.5 curl 验证：`GET /users/lookup?identifier=` 精确匹配 username/email 均能查到，返回体不含 email；查不到返回 `404`
- [x] 9.6 浏览器验证：创建 Wiki（带/不带封面图）→ Card 列表正确展示 → hover 出现设置入口且不误触发导航
- [x] 9.7 浏览器验证：`OWNER` 在设置面板改名/换封面图/查找添加成员/改角色/移除成员/删除工作区全部生效；`EDITOR`/`VIEWER` 账号登录后对应按钮不可见或不可点击
- [x] 9.8 浏览器验证：Pin/取消 Pin 后 Sidebar 列表正确显示 Wiki 名称
- [x] 9.9 清理验证过程中产生的测试数据（工作区、测试账号、MinIO 里的测试图片对象）
