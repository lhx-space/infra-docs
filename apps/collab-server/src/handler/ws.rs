//! WebSocket 连接入口（Yjs 同步协议，见 design.md 决策 1/3/4）。
//!
//! 连接建立流程（对应 tasks.md 3.6）：
//! 1. 从查询参数取出 access token（`?token=...`），本地校验签名与过期时间
//!    （`utils::jwt::verify_access_token`，决策 3）——校验失败直接返回 401，不升级
//!    为 WebSocket；
//! 2. 用取出的 `userId` + 目标 `document_id` 调用 `AccessControlService.CheckDocumentRole`
//!    （决策 2/4）——`granted = false` 返回 403，不升级；
//! 3. 校验通过后才调用 `ws.on_upgrade(...)`，按角色分配只读/可写连接模式，加入对应
//!    文档的协同房间（`service::collab::RoomRegistry`）。

use std::collections::HashMap;
use std::sync::Arc;

use axum::extract::ws::WebSocketUpgrade;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use futures_util::StreamExt;
use tokio::sync::Mutex as TokioMutex;

use crate::middleware::auth::ConnectionMode;
use crate::service::AppState;
use crate::service::collab::ReadOnlyProtocol;
use crate::service::ws_adapter::{WsSink, WsStream};
use crate::utils::jwt::verify_access_token;

pub async fn upgrade(
    ws: WebSocketUpgrade,
    Path(document_id): Path<String>,
    Query(params): Query<HashMap<String, String>>,
    State(state): State<AppState>,
) -> Response {
    let Some(token) = params.get("token") else {
        return (StatusCode::UNAUTHORIZED, "missing token").into_response();
    };

    let claims = match verify_access_token(token, &state.config.jwt_secret) {
        Ok(claims) => claims,
        Err(_) => return (StatusCode::UNAUTHORIZED, "invalid or expired token").into_response(),
    };
    let user_id = claims.sub;

    let mode = match state.grpc.check_document_role(&user_id, &document_id).await {
        Ok((true, role)) => ConnectionMode::from(role),
        Ok((false, _)) => return (StatusCode::FORBIDDEN, "forbidden").into_response(),
        Err(err) => {
            tracing::error!(%err, %document_id, "check_document_role grpc call failed");
            return (
                StatusCode::SERVICE_UNAVAILABLE,
                "access control unavailable",
            )
                .into_response();
        }
    };

    ws.on_upgrade(move |socket| handle_socket(socket, document_id, mode, user_id, state))
}

async fn handle_socket(
    socket: axum::extract::ws::WebSocket,
    document_id: String,
    mode: ConnectionMode,
    user_id: String,
    state: AppState,
) {
    let room = match state
        .rooms
        .get_or_create(&document_id, &state.db, &state.grpc)
        .await
    {
        Ok(room) => room,
        Err(err) => {
            tracing::error!(%err, %document_id, "failed to load collab room");
            let _ = socket.close().await;
            return;
        }
    };

    tracing::info!(%document_id, %user_id, ?mode, "collab connection established");

    let (ws_sink, ws_stream) = socket.split();
    let sink = Arc::new(TokioMutex::new(WsSink::new(ws_sink)));

    let subscription = match mode {
        ConnectionMode::Writable => {
            let track_editor = Some((room.last_editor_id.clone(), user_id.clone()));
            let stream = WsStream::new(ws_stream, track_editor);
            room.broadcast.subscribe(sink, stream)
        }
        ConnectionMode::ReadOnly => {
            // 只读连接不需要追踪"最后写入者"——它的写入类消息本来就会被
            // ReadOnlyProtocol 拒绝应用，见 service::collab::ReadOnlyProtocol 顶部注释。
            let stream = WsStream::new(ws_stream, None);
            room.broadcast
                .subscribe_with(sink, stream, ReadOnlyProtocol)
        }
    };

    match subscription.completed().await {
        Ok(()) => tracing::info!(%document_id, %user_id, "collab connection closed gracefully"),
        Err(err) => {
            tracing::warn!(%document_id, %user_id, %err, "collab connection ended with error")
        }
    }
}
