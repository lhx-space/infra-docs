# syntax=docker/dockerfile:1
#
# apps/web 部署镜像：构建阶段需要整个 monorepo 上下文（workspace 依赖
# @luhanxin/tiptap-editor、@luhanxin/error-monitor 走 pnpm 软链接，只挂 apps/web
# 单目录解析不到），跟 apps/api/Dockerfile 是同一个原因。对应 docker-compose.yml 里
# web service 用 `context: .` + `dockerfile: apps/web/Dockerfile`。
#
# 运行时只需要伺服 Vite 打出来的纯静态文件（SPA，没有服务端渲染），不需要常驻 Node
# 进程，选专门做静态文件服务的镜像即可：
#   - 默认 `runtime`（nginx）：docker build 不带 --target 时的默认产物。
#   - 可选 `runtime-caddy`：构建时加 `--target runtime-caddy` 切换，配置更简单、
#     gzip/brotli/zstd 自动协商（见 apps/web/Caddyfile），本地已有 caddy:2-alpine
#     镜像缓存，二选一即可，产物（dist）完全一样，只是伺服的静态服务器不同。
#
# VITE_API_BASE_URL 是 Vite 的编译期常量（`import.meta.env.VITE_*`），构建完成后就
# 固化进 dist 产物里，运行时改环境变量不会生效——如果同一份代码要部署到多个 API 地址
# 不同的环境，需要针对每个环境分别传 --build-arg 重新构建镜像；这是 Vite 编译期常量的
# 机制决定的，跟 apps/api 靠运行时环境变量注入是两种完全不同的模型，不是这里刻意加的限制。

FROM node:22-alpine3.20 AS base
RUN corepack enable && corepack prepare pnpm@10.0.0 --activate
WORKDIR /repo

FROM base AS build
ARG VITE_API_BASE_URL=http://localhost:3000
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
# apps/collab-server 的 WebSocket 地址（同样是编译期常量，见上面 VITE_API_BASE_URL 的
# 说明）：之前这个 Dockerfile 只声明了 VITE_API_BASE_URL 一个，没有把 VITE_COLLAB_WS_URL
# 也透传进构建产物——这意味着用这份 Dockerfile 构建出来的镜像，`import.meta.env.VITE_COLLAB_WS_URL`
# 会是 undefined，实时协同功能整个不可用，是一个预先存在、直到这次排查 docker-compose 网络
# 配置才发现的真实缺陷（不是本次改动引入的）。
ARG VITE_COLLAB_WS_URL=ws://localhost:4000/ws
ENV VITE_COLLAB_WS_URL=${VITE_COLLAB_WS_URL}
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter=@luhanxin/tiptap-editor... --filter=@luhanxin/error-monitor... --filter=web... run build

# ===== 默认运行时：nginx =====
FROM nginx:1.27-alpine AS runtime
RUN rm -f /etc/nginx/conf.d/default.conf
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget -qO- http://127.0.0.1/healthz >/dev/null 2>&1 || exit 1
CMD ["nginx", "-g", "daemon off;"]

# ===== 可选运行时：Caddy（docker build --target runtime-caddy） =====
FROM caddy:2-alpine AS runtime-caddy
RUN apk add --no-cache wget
COPY apps/web/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget -qO- http://127.0.0.1/healthz >/dev/null 2>&1 || exit 1
