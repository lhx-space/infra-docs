# syntax=docker/dockerfile:1
#
# apps/api 部署镜像：workspace 依赖（@luhanxin/tiptap-editor 等）要求构建上下文是仓库根目录，
# 不能只用 apps/api 这一个子目录（pnpm workspace 的软链接解析不到根 lockfile/其他 package）。
# 对应 docker-compose.yml 里 api/worker 两个 service 都用 `context: .` + `dockerfile: apps/api/Dockerfile`。
#
# 新增 ffmpeg 二进制依赖（见 video-hls-embed design.md 决策 4）：worker 进程（src/worker.ts）
# 转码需要系统级 ffmpeg，跟 api 进程共用同一个镜像、只是启动命令不同（见 docker-compose.yml
# 的 worker service，两者复用同一次构建产物）。
#
# 生产构建产物由 tsup 产出（见 openspec/changes/system-performance-hardening design.md
# 决策 6/7），`api` 服务用 `pm2-runtime` 以 cluster 模式启动（决策 8，见
# apps/api/ecosystem.config.cjs）——`pm2-runtime` 是 PM2 专为容器场景提供的前台运行模式
# （不像普通 `pm2 start` 那样 daemonize 出一个分离的守护进程），作为容器 PID 1 能正确转发
# SIGTERM/SIGINT 信号，`docker-compose.yml` 的 `restart: unless-stopped` 与 PM2 自身的
# 进程内重启是两层独立、不冲突的机制。`worker` service 在 docker-compose.yml 里用
# `command: ['node', 'dist/worker.js']` 整体覆盖了这里的 CMD，不经过 PM2/cluster——它的
# 并发行为由代码里的 `VIDEO_TRANSCODE_CONCURRENCY` 控制，套 cluster 会被实例数隐性放大
# （见 design.md 决策 8）。
#
# 已本地验证：`docker build -f apps/api/Dockerfile .` 能够成功构建，构建产物
# （`dist/server.js`/`dist/worker.js`）在真实的 Postgres/Redis/MinIO 环境下均可正常启动
# （gRPC server 监听、Prisma 连接、ffmpeg 探活均通过，见 tasks.md 7.6/8.4 的验证记录）。

FROM node:22-alpine3.20 AS base
RUN apk add --no-cache ffmpeg
RUN corepack enable && corepack prepare pnpm@10.0.0 --activate
WORKDIR /repo

FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter=@luhanxin/tiptap-editor... --filter=@app/api... run build

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /repo /repo
WORKDIR /repo/apps/api
EXPOSE 3000
CMD ["npx", "pm2-runtime", "ecosystem.config.cjs"]
