## Context

三个互相独立、但都是"补健壮性/性能欠账"的问题域：

1. **文档编辑器渲染层**：`packages/tiptap-editor` 的 `DocumentEditor` 把整篇文档渲染进同一个 `contenteditable` 容器（`EditorContent`）。Mermaid（`MermaidView`）、视频（`VideoView`）、代码块（`CodeBlockView`）都用 `ReactNodeViewRenderer` 挂成常驻 React 组件——文档里有多少个这类节点，挂载时就实例化多少个，跟节点当前是否在视口内无关：`MermaidView` 每个实例各自触发一次 `mermaid.render()`；`VideoView`（未读，但按视频块的一般实现）各自起一份 HLS 播放资源。大纲导航（`useDocumentOutline`）监听 `editor.on('update', recompute)`，每次事务都对整棵 `doc` 跑一次 `descendants()` 全量扫描，是随文档变大而线性变差的高频路径（每次按键都会触发一次 `update`）。

2. **`collab-server`（Rust）对 `apps/api` 的 gRPC 依赖**：`GrpcClients::connect(addr)` 用 `Endpoint::connect_lazy()`，只推迟首次真实连接，不做重试/熔断。`handler::ws::upgrade` 里 `check_document_role` 失败直接返回 503，没有退避重试。`service::collab::spawn_persistence_task` 里 `sync_document_content` 失败只打一条 `tracing::warn!` 然后进入下一个 `interval` tick，等待时长是固定的 `persist_interval_secs`，没有"失败后更快重试"的机制，也没有连续失败计数/熔断。相比之下，`apps/api` 的视频转码链路有一套明确的健壮性策略：BullMQ 队列（任务持久化在 Redis，worker 崩溃重启后任务不丢）+ `cache/index.ts` 的 Redis 连接自带指数退避重试与"重试到上限后放弃并记录 `end` 事件"。这两处的健壮性水位不对等。

3. **`apps/api` 构建与生产进程**：`apps/api/tsconfig.build.json` 覆盖 `module`/`moduleResolution` 为 `nodenext`，配合 `package.json` 的 `"type": "module"`，要求所有相对导入显式带 `.js` 后缀——但代码库里没有一处这么写。实测 `pnpm --filter=@app/api build`（即 `tsc -p tsconfig.build.json`）直接报错：几十条 `TS2835`（缺 `.js` 后缀）+ 几个在 `nodenext` 解析下才会暴露的 CJS/ESM 互操作错误（`pino-http`/`ioredis` 被判定"不可调用/不可构造"）。CI 的 `Docker (build check)` job（`.github/workflows/ci.yml`）跑的正是 `docker build -f apps/api/Dockerfile`，其内部 `RUN pnpm ... run build` 即触发这条已知会失败的路径——这不是"预防性优化"，是当前构建链路里一个真实存在、需要先确认 CI 状态的缺陷。生产进程目前完全依赖 `docker-compose.yml` 的 `restart: unless-stopped` 兜底崩溃重启，`api`（Express）单进程运行，未利用多核。

## Goals / Non-Goals

**Goals:**
- 长文档场景下，视口外内容不参与浏览器布局/绘制计算；重 NodeView（Mermaid/视频）只在视口附近才建立真实渲染/播放资源
- `collab-server` 对 `apps/api` 的 gRPC 依赖具备退避重试 + 熔断，健壮性水位与 `apps/api` 现有的 Redis/BullMQ 策略对齐（不要求完全一致的实现手法，要求同等级的"暂时性故障可自愈、持续性故障可快速失败"效果）
- `apps/api` 的生产构建产物能够正确生成（`docker build` 通过），不再要求源码相对导入携带 `.js` 后缀
- `api` 服务在生产环境下能利用多核（PM2 cluster），`worker` 的并发行为不受影响

**Non-Goals:**
- 不做真正的内容虚拟化（视口外节点从 DOM 摘除/替换）——ProseMirror 的方向键移动、选区、IME 组合输入依赖浏览器对整棵 `contenteditable` 树的原生支持，社区没有生产级的"每块独立虚拟化"方案（跟 Notion 完全不同的架构，那是自研 block 模型 + 虚拟列表，非 `contenteditable`），本次只做"跳过视口外渐染成本"而不移除节点
- 不重新设计 `collab-server` 的持久化模型（仍是全量快照式持久化，不引入增量持久化/本地 WAL 之类的架构变更）
- 不改变任何对外 HTTP/gRPC 接口契约、不涉及数据库 schema 变更
- 不给 `worker`（BullMQ 消费者）引入 PM2 cluster，避免并发上限被进程数隐性放大

## Decisions

### 决策 1：用 `content-visibility: auto` 而非虚拟化解决视口外渲染成本
纯 CSS，不改变 DOM 结构，`contenteditable` 内的方向键移动/选区/IME 行为不受影响（节点仍在 DOM 里，只是浏览器跳过其布局/绘制阶段）。需要给可能塌陷高度的容器配 `contain-intrinsic-size` 兜底，避免首次滚动时估算高度不准导致的滚动跳动。备选方案"摘除视口外 DOM 节点"因为会打断 ProseMirror 对 DOM 位置的原生依赖而放弃（见 Non-Goals）。

### 决策 2：大纲扫描防抖，不改变触发时机（仍监听 `update`）
只是把"每次 `update` 都跑一次 `descendants()`"改成"停止输入一小段时间后才跑"，跟编辑器现有的自动保存防抖（`autosaveDelay`，默认 800ms）是同一个模式，复用用户已经熟悉的"停顿感"，不引入新的交互心智负担。

### 决策 3：Mermaid/视频用 `IntersectionObserver` 懒挂载，占位保留高度
NodeView 组件内部包一层观察容器：未进入视口（含一定 buffer margin）时只渲染一个高度占位（Mermaid 用图表最近一次已知渲染高度或默认高度；视频用视频原始尺寸推导的比例占位），避免"进入视口后突然撑高/塌陷"造成的滚动跳动；进入视口才触发 `mermaid.render()` / 建立播放器实例，离开视口销毁播放器释放解码资源（Mermaid 的 SVG 保留在内存不必销毁，重渲染成本高、内存占用相对低）。编辑态的 Mermaid（`mode: 'editing'`）不受懒挂载影响——正在编辑的图表默认认为在视口内。

### 决策 4：collab-server 的重试用手写指数退避循环，不引入 `tower::retry` 等中间件框架
调用点少（三个 gRPC 方法），失败语义也不完全一致（`check_document_role` 失败要转成 HTTP 503 而不是重试到底——连接鉴权是同步等待用户的请求路径，重试次数必须很少，2~3 次、每次几十到上百毫秒退避；持久化的 `sync_document_content` 允许更宽松的重试，因为它本来就是异步周期性任务）。引入通用重试框架收益不成比例，手写一个几行的退避循环更直接、也更容易按场景调整重试策略。

### 决策 5：熔断器用简单的滑动窗口计数器，状态挂在 `AppState`（`Arc` 包裹，跨请求共享）
不引入 `failsafe`/`tower::hedge` 等第三方熔断库——需求很单一（连续失败 N 次后 open，等待 T 秒后 half-open 尝试一次探测，成功则 close），手写一个 `Arc<Mutex<CircuitState>>` 足够。同时覆盖连接鉴权路径（`check_document_role`）和持久化路径（`sync_document_content`）用同一个熔断器实例（都是"`apps/api` 是否可达"这一个信号），避免两条路径各自判断、状态不一致。

### 决策 6：`apps/api` 生产构建从 `tsc` 直接产出切换为打包器（`tsup`）
复用 `packages/tiptap-editor` 已经在用的 `tsup`（esbuild 驱动），配置风格保持一致，团队只需要维护一套"打包器怎么用"的心智模型。`tsc --noEmit`（当前 `tsconfig.json`，`moduleResolution: Bundler`）继续保留为独立的类型检查步骤（`typecheck` 脚本、CI 里已经在跑），构建产物的生成完全交给 `tsup`，两者解耦：类型检查不阻塞构建产物生成的模块解析方式，构建产物生成也不需要为了满足 `nodenext` 的语法要求去改全部导入语句。备选方案"手动给所有相对导入加 `.js` 后缀"因改动面过大（几十个文件）且后续每次新增文件都要记住这条约定，选择打包器路线维护成本更低。

### 决策 7：打包器 external 列表显式声明，不依赖自动推断
`sharp`（原生二进制）、`pg`/`ioredis`（数据库/缓存客户端，很多打包器对其动态 `require` 分支处理不稳定）、`fluent-ffmpeg`（子进程调用外部 `ffmpeg` 二进制，不应被打包改写路径）、`@grpc/grpc-js` + `@grpc/proto-loader`（`proto-loader` 运行时用文件系统路径读取 `.proto` 文件，打包后路径必须保持可解析）、Prisma 生成的 client（`generated/prisma/client` 有自己的二进制引擎加载逻辑）——这些全部显式列入打包器的 `external`，构建产物里对它们的 `import`/`require` 保持原样，运行时仍从 `node_modules` 正常加载。不依赖打包器"自动识别 package.json dependencies 为 external"的默认行为，因为这个行为在不同打包器/版本间不完全一致，显式列表更可控、也方便 code review 时一眼看出哪些依赖被排除在打包之外。

### 决策 8：PM2 只用于 `api` 服务的 cluster 模式，`worker` 维持单进程直接 `node dist/worker.js`
`api` 是无状态的 HTTP+gRPC 服务，cluster 多实例共享监听端口是标准场景，直接受益于多核。`worker` 的并发行为由代码里显式的 `VIDEO_TRANSCODE_CONCURRENCY`（BullMQ `Worker` 的 `concurrency` 选项）控制，这个值的设计前提是"进程内的并发上限"（见 `queue/video-transcode.ts` 顶部注释：`os.cpus().length / VIDEO_TRANSCODE_CONCURRENCY` 推导每任务线程数，隐含假设只有一个 worker 进程在跑）。如果给 `worker` 也套 PM2 cluster（比如 4 个实例），实际并发会变成 `4 × VIDEO_TRANSCODE_CONCURRENCY`，CPU 争抢的问题会重新出现，且需要重新设计"进程数 × 并发数"的联合调参——本次不做，`worker` 保持现状，多机横向扩展仍然可以靠加更多容器实例实现（`docker-compose` 层面），跟 PM2 cluster 是两个独立的扩展维度。

## Risks / Trade-offs

- **[风险] `content-visibility: auto` 在部分场景下的高度估算不准，导致首次滚动到某区域时出现轻微的滚动位置跳动** → 缓解：给关键容器配 `contain-intrinsic-size` 提供更接近真实高度的估算值；这是已知的、影响面有限的浏览器行为，不影响内容正确性，可以在实现阶段针对 Mermaid/表格/图片这几类高度差异较大的块单独调参。
- **[风险] Mermaid/视频懒挂载的 `IntersectionObserver` buffer margin 设置不当，导致快速滚动时用户短暂看到占位而非内容** → 缓解：buffer margin 取一屏左右的高度（而不是 0），给渲染留出提前量；这是性能与"零感知延迟"之间的权衡，倾向于容忍极少数快速滚动场景下的短暂占位，换取大多数场景下的渲染成本下降。
- **[风险] 熔断器 open 状态期间，`check_document_role` 快速失败会让用户看到"连接异常"的频率变高（即使 `apps/api` 只是短暂抖动，尚不到需要熔断的程度）** → 缓解：熔断阈值（连续失败次数）需要足够宽松，只在"明显持续故障"而非"单次抖动"时触发，具体阈值在 tasks 落地阶段结合本地故障注入测试调整。
- **[风险] 打包器 external 列表遗漏某个运行时依赖，导致生产环境启动报"module not found"** → 缓解：Docker 构建校验（CI 已有的 `Docker (build check)` job）作为强制性验证手段，落地阶段必须实际跑通一次 `docker build` + 容器内 `node dist/server.js` 启动自检，不能只验证 `tsc`/打包器本身不报错。
- **[风险/权衡] PM2 cluster 模式下，进程内的一次性初始化逻辑（如 `ensureStorageReady`/`ensureVideoStorageReady`）会被每个 worker 进程各自执行一次** → 这是 cluster 模式的固有特性（多进程各自独立启动），需要确认这些初始化逻辑本身是幂等的（大概率是，因为它们本来就是"确保某个 bucket/表存在"这类幂等操作），不需要额外去重机制。

## Migration Plan

分三条独立的部署路径，互不阻塞：

1. **文档编辑器渲染优化**：`packages/tiptap-editor` 发新版本 → `apps/web` 重新构建。纯前端改动，无需数据迁移，无需协调后端发布顺序，可随时回滚（回退 npm 包版本 + 重新构建即可）。
2. **`collab-server` 健壮性**：Rust 侧改动，重新构建镜像发布。不改变 gRPC 契约（`.proto` 不变），不需要与 `apps/api` 同步发布，可独立回滚（回退镜像版本）。
3. **`apps/api` 构建工具链 + PM2**：这一项改的是构建/部署方式本身，风险相对高，必须先在本地/CI 跑通 `docker build` + 容器内实际启动验证（见上面的风险缓解），再合并；PM2 引入是 `Dockerfile` CMD 的替换，回滚只需要把 `CMD` 换回 `node dist/server.js`。建议先合并构建工具链部分（修复当前已知的构建失败）并观察 CI 的 Docker 构建 job 转绿，PM2 cluster 作为同一批次里相对独立的第二步，方便出问题时单独定位是构建产物问题还是进程管理问题。

## Open Questions

- 熔断器的具体阈值（连续失败次数、open 状态持续时长、half-open 探测间隔）需要多少经验数据才能定下来，还是先用一组保守的默认值上线观察？倾向后者，落地阶段先给一组保守默认值，不阻塞整个 change。
- "建议拆分为子文档"的块数阈值定多少合适（文档目前没有真实的"超大文档"样本数据）？倾向先给一个偏保守的默认阈值（如块数 300+），后续根据真实使用情况调整，不是这次改动需要精确定案的事项。
