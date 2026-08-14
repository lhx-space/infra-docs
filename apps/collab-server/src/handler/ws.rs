//! WebSocket 连接入口（Yjs 同步协议，见 design.md 决策 1）。
//!
//! TODO（tasks.md 3.2/3.6）：
//! 1. 从升级请求中取出 access token 与目标 `document_id`；
//! 2. 走 `middleware::auth` 描述的鉴权流程（本地校验签名 → gRPC 查角色）；
//! 3. 鉴权通过后，把连接交给 `service::collab` 管理的房间（按 `document_id` 分组），
//!    用 `y-sync` 处理该连接后续的 sync/awareness 消息。
//!
//! 目前只是一个可以 `cargo run` 起服务、能完成 WS 升级握手的最小骨架，尚未接入
//! 鉴权与 CRDT 同步逻辑。

use axum::{
    extract::{
        Path, State,
        ws::{WebSocket, WebSocketUpgrade},
    },
    response::IntoResponse,
};

use crate::service::AppState;

pub async fn upgrade(
    ws: WebSocketUpgrade,
    Path(document_id): Path<String>,
    State(state): State<AppState>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_socket(socket, document_id, state))
}

async fn handle_socket(socket: WebSocket, document_id: String, _state: AppState) {
    tracing::info!(%document_id, "collab connection established (placeholder, no auth/sync yet)");
    // TODO: 接入鉴权 + y-sync 消息处理循环，替换掉下面这个占位实现。
    let _ = socket.close().await;
}
