pub mod collab;
pub mod grpc_client;
pub mod ws_adapter;

use std::sync::Arc;
use std::time::Duration;

use sqlx::PgPool;

use crate::service::collab::RoomRegistry;
use crate::service::grpc_client::GrpcClients;
use crate::utils::config::Config;

/// Axum 的共享状态：
/// - `db`：数据库连接池，`repository` 直连读写 `yjsState`（见 design.md 决策 5）；
/// - `grpc`：gRPC 客户端，调用 `apps/api` 完成业务规则判断（见决策 2）；
/// - `rooms`：按 `document_id` 分组的协同房间注册表（见 `service::collab`）。
#[derive(Clone)]
pub struct AppState {
    pub config: Config,
    pub db: PgPool,
    pub grpc: GrpcClients,
    pub rooms: Arc<RoomRegistry>,
}

impl AppState {
    pub async fn new(config: Config) -> anyhow::Result<Self> {
        let db = PgPool::connect(&config.database_url).await?;
        let grpc = GrpcClients::connect(&config.api_grpc_addr)?;
        let rooms = Arc::new(RoomRegistry::new(Duration::from_secs(
            config.persist_interval_secs,
        )));
        Ok(Self {
            config,
            db,
            grpc,
            rooms,
        })
    }
}
