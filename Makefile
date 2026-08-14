.PHONY: help install setup \
        up up-full down logs ps \
        dev-collab check clippy fmt fmt-check test-rust build-rust \
        dev-web dev-api build-node lint lint-fix typecheck \
        proto-gen \
        build clean

.DEFAULT_GOAL := help

RUST_PKG := collab-server

help: ## 显示所有可用命令
	@awk 'BEGIN {FS = ":.*##"; printf "\n\033[1mUsage:\033[0m\n  make \033[36m<target>\033[0m [VAR=value]\n\n\033[1mTargets:\033[0m\n"} \
	/^[a-zA-Z_-]+:.*?##/ { printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2 } \
	/^# ====/ { sub(/^# /,""); printf "\n\033[1m%s\033[0m\n", $$0 }' $(MAKEFILE_LIST)

# ==== 环境与初始化 ====

install: ## 安装 Node 依赖 (pnpm install)
	pnpm install

setup: install ## 首次初始化：安装依赖 + 生成各服务 .env
	@test -f apps/api/.env || cp apps/api/.env.example apps/api/.env
	@test -f apps/collab-server/.env || cp apps/collab-server/.env.example apps/collab-server/.env
	@echo "\n✓ 初始化完成"

# ==== 基础设施 (Docker) ====

up: ## 启动本地基础设施 (postgres/redis/minio)
	docker compose up -d

up-full: ## 启动全部服务，含 api/worker/collab-server 容器
	docker compose --profile full up -d --build

down: ## 停止所有服务
	docker compose down

logs: ## 跟踪日志 (make logs s=postgres)
	docker compose logs -f $(s)

ps: ## 查看服务状态
	docker compose ps

# ==== Rust (apps/collab-server) ====
# 见 openspec/changes/yjs-realtime-collaboration/design.md 决策 1：独立 Rust 服务，
# 跟 infra-sso 复用同一套工具链习惯（cargo check/clippy/fmt）。

dev-collab: ## 启动协同服务开发模式 (cargo run)
	cargo run -p $(RUST_PKG)

check: ## cargo check（全部 workspace 成员）
	cargo check

clippy: ## cargo clippy（警告即错误）
	cargo clippy -- -D warnings

fmt: ## 格式化 Rust 代码
	cargo fmt

fmt-check: ## 检查 Rust 代码格式（不修改）
	cargo fmt -- --check

test-rust: ## Rust 测试
	cargo test

build-rust: ## 构建 Rust release 二进制
	cargo build --release

# ==== Node / 前端 (apps/web, apps/api, packages/*) ====

dev-web: ## 启动 apps/web 开发服务器
	pnpm --filter web dev

dev-api: ## 启动 apps/api 开发模式（含 worker，见 apps/api/package.json）
	pnpm --filter @app/api dev

build-node: ## 构建全部 Node/前端产物（apps/*、packages/*，不含 Rust）
	pnpm build

lint: ## biome + stylelint 检查
	pnpm lint

lint-fix: ## 自动修复 lint 问题
	pnpm lint:fix

typecheck: ## TypeScript 全量类型检查
	pnpm typecheck

# ==== 服务间通信 (gRPC，见 design.md 决策 10) ====

proto-gen: ## 根据 /protos 重新生成 gRPC 代码
	@echo "Rust 侧：build.rs 会在 'cargo build' 时自动重新生成，无需单独执行"
	@echo "TS 侧（apps/api）：TODO，接入 ts-proto/buf 生成脚本，见 yjs-realtime-collaboration tasks.md 1.2"

# ==== 复合命令 ====

build: build-rust build-node ## 全量构建（Rust + Node/前端）

clean: ## 清理所有构建产物 + 停止容器
	cargo clean
	pnpm -r exec rm -rf dist || true
	docker compose down -v
