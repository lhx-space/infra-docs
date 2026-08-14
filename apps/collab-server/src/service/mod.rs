pub mod collab;
pub mod grpc_client;

use sqlx::PgPool;

use crate::utils::config::Config;

/// Axum 的共享状态：数据库连接池（`repository` 直连读写 `yjsState`，见 design.md 决策 5）
/// + gRPC 客户端（`grpc_client`，调用 `apps/api` 完成业务规则判断，见决策 2）。
#[derive(Clone)]
pub struct AppState {
    pub config: Config,
    pub db: PgPool,
}

impl AppState {
    pub async fn new(config: Config) -> anyhow::Result<Self> {
        let db = PgPool::connect(&config.database_url).await?;
        Ok(Self { config, db })
    }
}
