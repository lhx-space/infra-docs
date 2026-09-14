//! STT 端点（见 design.md 决策 16）：音频字节 → 文字。前端 `MediaRecorder` 录音后
//! 把 blob 作为请求体发来（`?filename=audio.webm`），返回 `{text}`。
use std::collections::HashMap;

use axum::Json;
use axum::body::Bytes;
use axum::extract::{Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::IntoResponse;
use axum::response::Response;
use serde_json::json;

use crate::service::AppState;
use crate::utils::jwt::verify_access_token;

pub async fn transcribe(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(params): Query<HashMap<String, String>>,
    body: Bytes,
) -> Response {
    let Some(token) = headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.strip_prefix("Bearer "))
    else {
        return (StatusCode::UNAUTHORIZED, "missing token").into_response();
    };
    match verify_access_token(token, &state.jwt_secret) {
        Ok(_claims) => {}
        Err(_) => return (StatusCode::UNAUTHORIZED, "invalid or expired token").into_response(),
    };

    let filename = params
        .get("filename")
        .cloned()
        .unwrap_or_else(|| "audio.webm".to_string());

    let text = match state.transcribe.transcribe(body.to_vec(), &filename).await {
        Ok(text) => text,
        Err(err) => {
            tracing::error!(%err, "transcribe failed");
            return (StatusCode::INTERNAL_SERVER_ERROR, err.to_string()).into_response();
        }
    };

    Json(json!({ "text": text })).into_response()
}
