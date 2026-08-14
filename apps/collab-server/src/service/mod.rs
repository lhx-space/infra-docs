pub mod circuit_breaker;
pub mod collab;
pub mod grpc_client;
pub mod ws_adapter;

use std::sync::Arc;
use std::time::Duration;

use sqlx::PgPool;

use crate::service::circuit_breaker::CircuitBreaker;
use crate::service::collab::RoomRegistry;
use crate::service::grpc_client::GrpcClients;
use crate::utils::config::Config;

/// Axum 的共享状态：
/// - `db`：数据库连接池，`repository` 直连读写 `yjsState`（见 design.md 决策 5）；
/// - `grpc`：gRPC 客户端，调用 `apps/api` 完成业务规则判断（见决策 2）；
/// - `rooms`：按 `document_id` 分组的协同房间注册表（见 `service::collab`）；
/// - `circuit_breaker`：对 `apps/api` 的可达性熔断信号，连接鉴权路径
///   （`handler::ws::upgrade`）与持久化路径（`service::collab::spawn_persistence_task`）
///   共用同一个实例（都是"`apps/api` 是否可达"这一个信号，见
///   system-performance-hardening design.md 决策 5）——但只有连接鉴权路径会真正被
///   它的 `before_call()` 快速失败拦截，持久化路径只上报成功/失败结果，不因为熔断
///   开启就跳过尝试（它自己有独立的快速重试机制，见 `service::collab` 里的说明）。
#[derive(Clone)]
pub struct AppState {
    pub config: Config,
    pub db: PgPool,
    pub grpc: GrpcClients,
    pub rooms: Arc<RoomRegistry>,
    pub circuit_breaker: Arc<CircuitBreaker>,
}

impl AppState {
    pub async fn new(config: Config) -> anyhow::Result<Self> {
        let db = PgPool::connect(&config.database_url).await?;
        let grpc = GrpcClients::connect(&config.api_grpc_addr)?;
        let circuit_breaker = Arc::new(CircuitBreaker::with_default_thresholds());
        let rooms = Arc::new(RoomRegistry::new(
            Duration::from_secs(config.persist_interval_secs),
            circuit_breaker.clone(),
        ));
        Ok(Self {
            config,
            db,
            grpc,
            rooms,
            circuit_breaker,
        })
    }
}
