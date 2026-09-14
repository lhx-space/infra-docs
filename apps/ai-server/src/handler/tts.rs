//! TTS 端点（见 design.md 决策 15）：输入文本 → 返回音频字节（mp3）。
use axum::Json;
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode, header};
use axum::response::IntoResponse;
use axum::response::Response;
use serde::Deserialize;

use crate::service::AppState;
use crate::utils::jwt::verify_access_token;

#[derive(Debug, Deserialize)]
pub struct TtsRequest {
    pub text: String,
    pub voice: Option<String>,
}

pub async fn tts(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<TtsRequest>,
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

    let voice = body
        .voice
        .unwrap_or_else(|| state.tts_voice.as_ref().clone());
    let audio = match state.tts.synthesize(&body.text, &voice).await {
        Ok(audio) => audio,
        Err(err) => {
            tracing::error!(%err, "tts synthesize failed");
            return (StatusCode::INTERNAL_SERVER_ERROR, err.to_string()).into_response();
        }
    };

    ([(header::CONTENT_TYPE, "audio/mpeg")], audio).into_response()
}
