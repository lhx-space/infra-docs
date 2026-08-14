# ===== 构建阶段 =====
FROM rust:1.94-bookworm AS builder
WORKDIR /app

# build.rs 里的 tonic-build 需要系统级 protoc 二进制来编译 .proto 契约，
# rust:*-bookworm 基础镜像不自带这个二进制，必须显式装（跟 CI 里的
# `protobuf-compiler` apt 包是同一个东西）。
RUN apt-get update && apt-get install -y --no-install-recommends protobuf-compiler \
    && rm -rf /var/lib/apt/lists/*

# 复制 cargo 配置（国内镜像源，见 .cargo/config.toml）
COPY .cargo .cargo

# 复制 workspace 配置 + 源码（workspace 成员必须存在才能编译）
COPY Cargo.toml Cargo.lock ./
COPY apps/collab-server apps/collab-server
COPY protos protos

RUN cargo build --release -p collab-server

# ===== 运行阶段 =====
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/target/release/collab-server /usr/local/bin/collab-server
EXPOSE 4000
CMD ["collab-server"]
