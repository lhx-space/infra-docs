# ===== 构建阶段 =====
FROM rust:1.94-bookworm AS builder
WORKDIR /app

# crates/rig-common/build.rs 里的 tonic-build 需要系统级 protoc 二进制编译 .proto 契约，
# 与 collab-server 的 Dockerfile 同理。
RUN apt-get update && apt-get install -y --no-install-recommends protobuf-compiler \
    && rm -rf /var/lib/apt/lists/*

# 复制 cargo 配置（国内镜像源，见 .cargo/config.toml）
COPY .cargo .cargo

# 复制 workspace 配置 + 源码。ai-server 依赖 crates/*（rig-common/rig-rag-agent/
# rig-editor-agent）与 /protos；workspace 根 Cargo.toml 的 members 列表里还有
# collab-server，cargo 解析 workspace 时要求每个 member 的 Cargo.toml 存在，所以这里
# 也把 apps/collab-server 一并复制（冗余但保证 workspace 完整）。
COPY Cargo.toml Cargo.lock ./
COPY apps/ai-server apps/ai-server
COPY apps/collab-server apps/collab-server
COPY crates crates
COPY protos protos

RUN cargo build --release -p ai-server

# ===== 运行阶段 =====
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/target/release/ai-server /usr/local/bin/ai-server
EXPOSE 4100
CMD ["ai-server"]
