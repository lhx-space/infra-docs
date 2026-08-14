// 本包目前是 openspec/changes/yjs-realtime-collaboration 的工程化脚手架阶段：模块结构、
// 类型骨架已经搭好（handler/middleware/service/repository/utils 分层，对齐 infra-sso 的
// 项目约定），但 tasks.md 里"接入真实鉴权/CRDT 同步/gRPC 调用"这些任务还没开始实现，
// 因此存在大量尚未被其他模块引用的类型与函数——这是预期状态，不是遗留的死代码。
// 每个模块完成对应任务后应逐步移除这条 allow，恢复 dead_code 检查。
#![allow(dead_code)]

mod handler;
mod middleware;
mod proto;
mod repository;
mod route;
mod service;
mod utils;

use utils::config::Config;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // 本地开发读取 .env；生产环境由容器运行时（docker-compose/K8s）直接注入环境变量，
    // 找不到 .env 文件时静默忽略，跟 apps/api 的 `--env-file` 用法保持同样的"可选"语义。
    let _ = dotenvy::dotenv();

    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .json()
        .init();

    let config = Config::from_env()?;
    tracing::info!(host = %config.host, port = config.port, "collab-server starting");

    let app_state = service::AppState::new(config.clone()).await?;
    let app = route::build_router(app_state);

    let listener = tokio::net::TcpListener::bind((config.host.as_str(), config.port)).await?;
    tracing::info!("collab-server listening");
    axum::serve(listener, app).await?;

    Ok(())
}
