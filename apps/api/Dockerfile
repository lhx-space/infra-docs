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
# 说明：这个 Dockerfile 是本轮新增的（仓库此前没有对应文件），未在本地实际执行过
# `docker build` 验证（构建耗时较长，且不是本次功能本身验证的关键路径，见 tasks.md 9.4~9.8
# 的验证范围）。结构基于标准 pnpm workspace 构建流程编写，如果实际构建时报错，需要按报错
# 信息针对性调整（比如 pnpm 版本、Prisma 生成产物路径等）。

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
CMD ["node", "dist/server.js"]
