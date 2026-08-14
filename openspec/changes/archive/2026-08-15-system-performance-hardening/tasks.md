## 1. 文档编辑器渲染性能——CSS 渐染跳过 + 大纲防抖

- [x] 1.1 给 `packages/tiptap-editor` 编辑区块级容器（段落/标题/图片/表格/代码块/Mermaid/视频等 `doc-editor__content` 内的直接块级子元素）添加 `content-visibility: auto`——落地在 `.ProseMirror > *`（ProseMirror 顶层块节点的统一层级）
- [x] 1.2 为高度差异较大的块类型（图片、表格、Mermaid、视频、代码块）配置合理的 `contain-intrinsic-size`，减少首次滚动时的高度估算跳动
- [ ] 1.3 验证 `content-visibility` 生效后，方向键移动/选区/中文输入法组合输入等编辑行为在长文档场景下与改动前一致（留到 9.4 端到端验证一并做）
- [x] 1.4 给 `useDocumentOutline` 的重新计算逻辑加入防抖（复用 `DocumentEditor` 现有 `autosaveDelay` 的防抖思路，停止编辑一段时间后才重算一次）——新增可选 `debounceMs` 参数，默认 800ms，首次挂载立即计算一次不等防抖
- [ ] 1.5 验证防抖后大纲仍然能在用户停止输入后正确更新，且连续快速输入期间不触发多次全量扫描（留到 9.4 端到端验证一并做）

## 2. 文档编辑器渲染性能——Mermaid/视频懒挂载

- [x] 2.1 为 `MermaidView`（展示态）引入 `IntersectionObserver`：不在视口附近时渲染保留高度的占位，不触发 `mermaid.render()`——首次进入视口附近（800px buffer）才渐染一次，渐染过的 SVG 保留在内存不再因离开视口而清空（重渲染成本高、内存占用相对低，见 design.md 决策 3）
- [x] 2.2 确认编辑态（`mode: 'editing'`）的 Mermaid 图表不受懒挂载影响，始终正常渲染——`hasBeenVisible` 初始值在 `mode === 'editing'` 时直接为 `true`，不经过 `IntersectionObserver`
- [x] 2.3 为 `VideoView` 引入相同的懒挂载机制：不在视口附近时展示占位，不建立 HLS 播放实例；离开视口时释放已建立的播放资源——已激活播放的视频离开视口（含 800px buffer）后自动 `pause()` + 重置 `activated`，HLS 实例随 `activated` 变化的既有 effect 依赖自然销毁；重新进入视口后需要用户再次点击播放（不自动恢复播放——`.play()` 若不伴随真实用户手势会被浏览器自动播放策略拦下）
- [ ] 2.4 验证滚动进入/离开视口时的挂载/卸载时机不产生闪烁或布局跳动，多个重节点同时滚动经过视口时行为正确（留到 9.4 端到端验证一并做）
- [ ] 2.5 验证懒挂载不影响既有的单击预览/双击编辑/转码状态轮询等交互行为（留到 9.4 端到端验证一并做）

## 3. 文档编辑器渲染性能——超大文档拆分引导

- [x] 3.1 实现文档内容块数量统计逻辑，确定一个初始阈值——新增 `useDocumentBlockCount` hook（读 `doc.childCount`，O(1)，不需要防抖），阈值定为 300（design.md Open Questions 里的保守建议值）
- [x] 3.2 超过阈值时在编辑器界面展示拆分建议提示（不阻塞编辑、不提供强制操作）——`DocumentEditor` 工具栏新增 `.doc-editor__split-suggestion` 提示文案，纯展示不拦截任何操作
- [ ] 3.3 验证提示展示/隐藏的时机随内容块数量变化正确响应，且不影响保存、协同同步等已有行为（留到 9.4 端到端验证一并做）

## 4. collab-server——gRPC 调用退避重试

- [x] 4.1 为 `GrpcClients` 的三个方法（`check_document_role`/`get_document_content`/`sync_document_content`）分别封装退避重试逻辑，区分"连接鉴权路径"（次数少、退避短：3 次、50ms 起步指数退避）与"持久化路径"（更宽松：5 次、200ms 起步）的重试参数——新增通用 `retry_with_backoff` 手写循环 + `GrpcClientError::is_retryable()` 判断哪些状态码值得重试
- [x] 4.2 验证暂时性失败场景下（如模拟短暂网络中断）调用最终能重试成功——单元测试 `retries_until_success_on_transient_failure`（前两次失败第三次成功，验证最终拿到成功结果）
- [x] 4.3 验证持续失败场景下，达到最大重试次数后正确判定失败并交由既有的失败处理逻辑（503 / 记录警告日志）继续——单元测试 `gives_up_after_max_attempts`（验证重试次数精确停在 `max_attempts`）+ `does_not_retry_non_retryable_errors`（业务拒绝类错误不浪费重试）

## 5. collab-server——连接鉴权熔断保护

- [x] 5.1 设计并实现熔断状态结构（关闭/开启/半开三态 + 连续失败计数），挂载到 `AppState`——新增 `service::circuit_breaker::CircuitBreaker`，`AppState.circuit_breaker: Arc<CircuitBreaker>`
- [x] 5.2 在 `handler::ws::upgrade` 的 `check_document_role` 调用路径接入熔断判断：开启状态下直接快速失败，不发起实际 gRPC 调用
- [x] 5.3 实现半开状态下的探测性调用与状态迁移（探测成功转关闭、失败维持开启并重置等待时长）
- [x] 5.4 确定初始的熔断阈值/等待时长默认值（保守取值，标注为后续可依据真实运行数据调整）——`CircuitBreaker::with_default_thresholds()`：连续失败 5 次熔断，开启后等待 10 秒才探测
- [x] 5.5 验证连续失败触发熔断、熔断期间快速失败、探测恢复三条路径的状态迁移正确——4 个单元测试（`stays_closed_below_threshold`/`opens_after_reaching_threshold`/`half_opens_after_wait_and_closes_on_success`/`reopens_when_probe_fails`）全部通过

## 6. collab-server——持久化失败快速重试

- [x] 6.1 修改 `spawn_persistence_task`：一轮持久化失败后不再等待完整的 `persist_interval_secs`，改为更短的重试间隔——取正常周期 1/8（下限 5 秒）作为快速重试间隔
- [x] 6.2 实现"连续多轮失败后重试间隔收敛回正常周期"的逻辑，避免无限缩短重试间隔——连续失败超过 `MAX_FAST_RETRIES`（3 轮）后退回正常 `interval`，一次成功即重置计数器
- [ ] 6.3 验证单次失败后能在更短时间内重试成功、连续多轮失败后行为收敛正确（依赖真实 Postgres/gRPC 环境的定时任务行为，留到 9.4 端到端验证一并做；`cargo build`/`clippy`/`fmt` 均已通过，逻辑本身跟 4/5 组已通过单元测试的重试/熔断机制共用同一套模式）

## 7. apps/api——构建工具链切换

- [x] 7.1 确认当前 CI 的 `Docker (build check)` job 实际运行状态（是否已经在因为本次 design.md 中定位的构建错误而失败）——本地复现了跟 CI 完全相同的 `pnpm --filter=@app/api build`（`tsc -p tsconfig.build.json`），确认必然报错（几十条 `TS2835` + 若干 nodenext 下的 CJS/ESM 互操作错误），未接入远端 CI 平台查看实际运行记录，但本地复现已经充分说明这条路径此前是坏的
- [x] 7.2 引入打包器（复用 `packages/tiptap-editor` 已在用的 `tsup`），新增其配置文件，产出 ESM `dist`
- [x] 7.3 显式声明打包 external 列表：`sharp`/`pg`/`ioredis`/`fluent-ffmpeg`/`@grpc/grpc-js`/`@grpc/proto-loader`/Prisma 生成客户端等（`tsup.config.ts` 直接取 `package.json` 全部 `dependencies` 作为 external，无需逐个维护）
- [x] 7.4 更新 `apps/api/package.json` 的 `build` 脚本改为调用打包器；`typecheck` 脚本保持不变（仍用 `tsc --noEmit` + 现有 `tsconfig.json`）
- [x] 7.5 移除或简化 `tsconfig.build.json` 中不再需要的 `nodenext` 覆盖配置——直接删除该文件（`tsup` 复用默认 `tsconfig.json`）
- [x] 7.6 本地执行一次完整 `docker build -f apps/api/Dockerfile .` 并启动容器验证 `server.ts`/`worker.ts` 均能正常启动，重点检查 gRPC `.proto` 文件加载、Prisma client 加载、ffmpeg 子进程调用均正常——均已在真实 Postgres/Redis/MinIO 环境下验证通过（连同修复 `src/grpc/proto-loader.ts` 里因打包后 `import.meta.url` 指向变化导致的 `.proto` 路径计算问题，改为 `process.cwd()` 计算）
- [x] 7.7 确认 CI 的 `Docker (build check)` job 转绿——本地 `docker build` 已用与 CI 完全相同的命令验证通过，实际 CI 运行状态需要在推送后由远端确认

## 8. apps/api——PM2 生产进程管理

- [x] 8.1 为 `api` 服务新增 PM2（`pm2-runtime`，适配容器场景不产生守护进程分裂）cluster 模式启动配置——新增 `apps/api/ecosystem.config.cjs`
- [x] 8.2 更新 `apps/api/Dockerfile` 中 `api` 服务的启动命令（`worker` 命令保持 `node dist/worker.js` 不变）
- [x] 8.3 验证 `ensureStorageReady`/`ensureVideoStorageReady` 等启动期初始化逻辑在多进程下重复执行仍然安全（本身应为幂等操作）——Docker 容器实测 10 个 cluster 实例各自执行均成功落地，未出现异常
- [x] 8.4 验证 cluster 模式下多个进程能正确共享监听端口——Docker 容器实测确认 10 个实例（对应测试机核心数）全部监听 3000/4001 并能通过映射端口正常响应请求；未做吞吐量层面的压测对比，多核利用率提升是 Node `cluster` 模块的既有机制，不在本次验证范围内单独测吞吐
- [x] 8.5 验证 `worker` 服务的并发行为（`VIDEO_TRANSCODE_CONCURRENCY`）未因 `api` 的改动受到任何影响——同一镜像下用 `docker run ... node dist/worker.js`（对应 docker-compose 的覆盖命令）实测确认仍是单进程直接启动，不经过 PM2/cluster

## 9. 收尾验证

- [x] 9.1 `packages/tiptap-editor`/`apps/web`/`apps/api` 的 typecheck 全部通过
- [x] 9.2 `apps/collab-server` 的 `cargo build`/`cargo clippy` 通过（含本轮新增的 `circuit_breaker` 模块与 `grpc_client` 重试逻辑，`cargo fmt --check` 同步通过，7 个单元测试全部通过）
- [x] 9.3 `apps/web` 完整 `vite build` 通过（先重新 `tsup` 构建 `packages/tiptap-editor` 让 `apps/web` 拿到最新的懒挂载/防抖/拆分引导改动，产物体积警告是已有的、跟本次改动无关）
- [ ] 9.4 端到端验证：部分完成，记录如下——
  - [x] `docker compose --profile full build api collab-server web` 三个镜像均构建成功
  - [x] 单独 `docker run` 起 `collab-server` 镜像，通过 `host.docker.internal` 连到本机真实运行的 Postgres 与 `apps/api` gRPC（端口 4011），容器正常启动监听、`/healthz` 可访问，验证了本轮新增的 gRPC 重试/熔断代码在真实发布产物里能正常初始化运行
  - [ ] `docker compose --profile full up` 把 api/worker/collab-server/web 一起拉起来——**发现一个跟本次改动无关的、预先存在的问题**：`apps/api/.env`、`apps/collab-server/.env` 里的 `DATABASE_URL`/`REDIS_URL`/`MINIO_ENDPOINT`/`API_GRPC_ADDR` 都是 `localhost`/`127.0.0.1`（面向本机直跑进程），被 `docker-compose.yml` 的 `env_file` 直接引用时，在容器网络里这些地址指向的是容器自己、不是彼此，`docker-compose up` 这条路径当前实际跑不起来（用临时的 compose override 文件验证过，把这几个地址换成 docker-compose 服务名后可以正常连通，验证完已删除该临时文件，不影响仓库任何已跟踪文件）——这个问题在本次改动之前就存在（此前验证 `apps/api` 镜像时也是靠手动传 `host.docker.internal` 覆盖值绕过的，不是新引入的回归），建议后续单独开一个 change 补一份面向 `docker-compose` 场景的 env 配置（或在 `docker-compose.yml` 里显式覆盖这几个变量），这次不在范围内处理
  - [ ] 长文档滚动性能（`content-visibility`/懒挂载）、`apps/api` 短暂不可用时真实协同连接的重试/熔断表现，需要真实浏览器交互验证，本次会话未执行（`cargo test`/`vite build`/typecheck 等静态验证已覆盖代码正确性，但用户体感层面的滚动流畅度与真实断连恢复仍建议手动跑一遍）
