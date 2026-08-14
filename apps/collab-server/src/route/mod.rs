use axum::{Router, routing::get};

use crate::handler;
use crate::service::AppState;

/// 路由组合入口（对齐 `infra-sso` 的 `route/` 分层约定）。
pub fn build_router(state: AppState) -> Router {
    Router::new()
        .route("/healthz", get(handler::health::healthz))
        .route("/ws/:document_id", get(handler::ws::upgrade))
        .with_state(state)
}
