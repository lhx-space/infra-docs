/**
 * PM2 生产进程配置——只管 `api`（HTTP + gRPC）服务的 cluster 模式（见
 * openspec/changes/system-performance-hardening design.md 决策 8）。
 *
 * `worker`（BullMQ 消费者，见 docker-compose.yml 里 `command: ['node', 'dist/worker.js']`）
 * 不经过这份配置、不套 PM2 cluster——它的并发行为由代码里的
 * `VIDEO_TRANSCODE_CONCURRENCY`（见 src/queue/video-transcode.ts）控制，这个值的推导
 * 前提是"进程内的并发上限"，如果套上 cluster 会被实例数隐性放大成
 * `实例数 × VIDEO_TRANSCODE_CONCURRENCY`，重新引入"多个 ffmpeg 进程互相抢核"的问题
 * （见 design.md 决策 8），`worker` 保持单进程直连 `node dist/worker.js`，不受这份配置影响。
 *
 * 用 `.cjs` 后缀强制 CommonJS——`package.json` 是 `"type": "module"`，PM2 生态对
 * ecosystem 配置文件的约定写法是 CommonJS `module.exports`，`.cjs` 后缀绕开 `type`
 * 字段的影响，不需要为了这一个配置文件专门改写成 ESM 语法。
 *
 * `instances` 默认 `'max'`（占满所有可用核心）——`api` 是无状态的 HTTP+gRPC 服务，多实例
 * 共享监听端口是标准场景（Node 的 `cluster` 模块对 `net`/`http`/`http2` 的监听是透明的，
 * `@grpc/grpc-js` 底层基于 `http2`，同样会被透明分发到各个实例，不需要任何额外代码改动）；
 * 可以通过 `PM2_INSTANCES` 环境变量覆盖（比如在资源受限的环境里限制为固定的较小值）。
 *
 * 启动期的一次性初始化（`ensureStorageReady`/`ensureVideoStorageReady`，见 src/server.ts）
 * 会在每个 cluster 实例里各自执行一次——这两个函数都是"确认 MinIO bucket 存在则跳过、
 * 不存在则创建"的幂等操作，并发重复执行是安全的（见 src/services/storage.ts /
 * video-storage.ts，失败只记录日志不会让进程崩溃），不需要额外的去重机制。
 */
module.exports = {
  apps: [
    {
      name: 'api',
      script: 'dist/server.js',
      exec_mode: 'cluster',
      instances: process.env['PM2_INSTANCES'] || 'max',
      // 容器场景下 docker-compose 的 `restart: unless-stopped` 已经兜底容器整体退出
      // 重启，这里是 PM2 管的进程内崩溃重启，两层不冲突；给一个保守的最大重启次数，
      // 避免反复崩溃触发的重启风暴掩盖真实问题、拖慢外层容器健康判断。
      max_restarts: 10,
      min_uptime: '10s',
      autorestart: true
    }
  ]
};
