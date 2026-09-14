//! AI 聊天 SSE 端点（见 design.md 决策 2/3/6/9/13）：
//! - `Authorization: Bearer <token>` 本地校验（决策 3）；
//! - `write` 模式：写作 agent，需 `CheckDocumentRole` 授予 EDITOR+（决策 6）；
//! - `ask` 模式：RAG 问答，`ListAccessibleWikis` 限定检索范围（决策 9）；
//! - 会话：`session_id` 关联 Redis 历史（决策 13），流式结束写回 user/assistant。
//!
//! 流式输出用 SSE（`data:` 帧），前端 `fetch` + `ReadableStream` + `TextDecoder` 消费。
use std::convert::Infallible;
use std::pin::Pin;
use std::sync::Arc;

use axum::Json;
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::response::IntoResponse;
use axum::response::Response;
use axum::response::sse::{Event, Sse};
use futures_util::Stream;
use futures_util::StreamExt;
use futures_util::stream;
use rig_common::collab_v1::WikiRole;
use rig_common::{ChatMessage, Role};
use rig_editor_agent::EditorContext;
use rig_rag_agent::RetrievedChunk;
use serde::Deserialize;
use tokio::sync::Mutex;

use crate::service::AppState;
use crate::service::session::SessionManager;
use crate::utils::jwt::verify_access_token;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatRequest {
    /// "write"（写作）| "ask"（知识库问答）
    pub mode: String,
    pub instruction: String,
    /// 会话 id（决策 13）：为空表示无会话（单轮），非空读写 Redis 历史。
    pub session_id: Option<String>,
    /// write 模式必填：目标文档 id（权限判断 + 上下文）
    pub document_id: Option<String>,
    pub title: Option<String>,
    pub selected_text: Option<String>,
    pub context_slice: Option<String>,
    /// 随消息附带的图片（base64），vision 理解（决策 17）
    pub images: Option<Vec<String>>,
}

pub async fn chat(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<ChatRequest>,
) -> Response {
    let Some(token) = bearer_token(&headers) else {
        return (StatusCode::UNAUTHORIZED, "missing token").into_response();
    };
    let claims = match verify_access_token(token, &state.jwt_secret) {
        Ok(claims) => claims,
        Err(_) => return (StatusCode::UNAUTHORIZED, "invalid or expired token").into_response(),
    };
    let user_id = claims.sub;

    match body.mode.as_str() {
        "write" => handle_write(state, user_id, body).await,
        "ask" => handle_ask(state, user_id, body).await,
        _ => (StatusCode::BAD_REQUEST, "unknown mode").into_response(),
    }
}

fn bearer_token(headers: &HeaderMap) -> Option<&str> {
    headers
        .get("authorization")?
        .to_str()
        .ok()?
        .strip_prefix("Bearer ")
}

/// 读会话历史（含滚动关键要点摘要，决策 13）；空 session_id 表示无会话。
async fn load_history(state: &AppState, session_id: &str) -> Vec<ChatMessage> {
    if session_id.is_empty() {
        return Vec::new();
    }
    state
        .session
        .build_history(session_id)
        .await
        .unwrap_or_default()
}

/// 把文本增量流转成 SSE 并累积到 `acc`（供流结束时写回会话）。
fn text_to_sse(
    stream: Pin<Box<dyn Stream<Item = Result<String, String>> + Send>>,
    acc: Arc<Mutex<String>>,
) -> Pin<Box<dyn Stream<Item = Result<Event, Infallible>> + Send>> {
    stream
        .then(move |item| {
            let acc = acc.clone();
            async move {
                match item {
                    Ok(text) => {
                        *acc.lock().await += &text;
                        Ok(Event::default().data(text))
                    }
                    Err(err) => Ok(Event::default().event("error").data(err)),
                }
            }
        })
        .boxed()
}

/// 流结束：把「user 指令 + 完整 assistant 回答」写回会话，并发出 `done` 事件。
async fn persist_and_done(
    session: Arc<SessionManager>,
    session_id: String,
    user_message: String,
    acc: Arc<Mutex<String>>,
) -> Result<Event, Infallible> {
    if !session_id.is_empty() {
        let text = acc.lock().await.clone();
        if !text.is_empty() {
            let _ = session
                .append(&session_id, ChatMessage::user(user_message))
                .await;
            let _ = session
                .append(&session_id, ChatMessage::assistant(text))
                .await;
        }
    }
    Ok(Event::default().event("done").data(""))
}

/// 写作模式（决策 6/7/13）：校验写权限后调写作 agent 流式生成。
async fn handle_write(state: AppState, user_id: String, body: ChatRequest) -> Response {
    let Some(document_id) = body.document_id.clone() else {
        return (
            StatusCode::BAD_REQUEST,
            "document_id required for write mode",
        )
            .into_response();
    };

    let (granted, role) = {
        let mut client = state.access_control.lock().await;
        match client.check_document_role(user_id, document_id).await {
            Ok(v) => v,
            Err(err) => {
                tracing::error!(%err, "check_document_role failed");
                return (
                    StatusCode::SERVICE_UNAVAILABLE,
                    "access control unavailable",
                )
                    .into_response();
            }
        }
    };

    if !granted || role < WikiRole::Editor as i32 {
        return (StatusCode::FORBIDDEN, "no edit permission").into_response();
    }

    let session_id = body.session_id.clone().unwrap_or_default();
    let history = load_history(&state, &session_id).await;

    let context = EditorContext {
        document_title: body.title.clone().unwrap_or_default(),
        selected_text: body.selected_text.clone(),
        context_slice: body.context_slice.clone(),
        instruction: body.instruction.clone(),
        images: body.images.clone().unwrap_or_default(),
    };

    let stream = match state.editor.generate(context, history).await {
        Ok(stream) => stream,
        Err(err) => {
            tracing::error!(%err, "editor agent generate failed");
            return (StatusCode::INTERNAL_SERVER_ERROR, err.to_string()).into_response();
        }
    };

    let acc = Arc::new(Mutex::new(String::new()));
    let sse = text_to_sse(stream, acc.clone())
        .chain(stream::once(persist_and_done(
            state.session.clone(),
            session_id,
            body.instruction,
            acc,
        )))
        .boxed();

    Sse::new(sse).into_response()
}

/// 问答模式（决策 9/13）：可访问范围内检索 → 无命中明确提示 → 有命中喂 LLM 生成带引用答案。
async fn handle_ask(state: AppState, user_id: String, body: ChatRequest) -> Response {
    let wiki_ids = {
        let mut client = state.ai_data.lock().await;
        match client.list_accessible_wikis(user_id).await {
            Ok(v) => v,
            Err(err) => {
                tracing::error!(%err, "list_accessible_wikis failed");
                return (
                    StatusCode::SERVICE_UNAVAILABLE,
                    "ai data service unavailable",
                )
                    .into_response();
            }
        }
    };

    let retrieved = match state.rag.retrieve(&body.instruction, &wiki_ids, 5).await {
        Ok(v) => v,
        Err(err) => {
            tracing::error!(%err, "rag retrieve failed");
            return (StatusCode::INTERNAL_SERVER_ERROR, err.to_string()).into_response();
        }
    };

    if retrieved.chunks.is_empty() {
        // 无命中：明确提示，不调 LLM 编造（spec「无命中时不编造」）
        let once = stream::once(async move {
            Ok::<_, Infallible>(Event::default().data("未在知识库中找到相关内容"))
        });
        return Sse::new(once).into_response();
    }

    let session_id = body.session_id.clone().unwrap_or_default();
    let history = load_history(&state, &session_id).await;
    let messages = build_ask_messages(
        &body.instruction,
        &retrieved.chunks,
        history,
        body.images.clone().unwrap_or_default(),
    );

    let stream = match state.chat.stream_chat(messages).await {
        Ok(stream) => stream,
        Err(err) => {
            tracing::error!(%err, "chat stream failed");
            return (StatusCode::INTERNAL_SERVER_ERROR, err.to_string()).into_response();
        }
    };

    let acc = Arc::new(Mutex::new(String::new()));
    let citations =
        stream::once(async move { Ok::<_, Infallible>(citations_event(&retrieved.chunks)) });
    let sse = text_to_sse(stream, acc.clone())
        .chain(citations)
        .chain(stream::once(persist_and_done(
            state.session.clone(),
            session_id,
            body.instruction,
            acc,
        )))
        .boxed();

    Sse::new(sse).into_response()
}

fn build_ask_messages(
    instruction: &str,
    chunks: &[RetrievedChunk],
    history: Vec<ChatMessage>,
    images: Vec<String>,
) -> Vec<ChatMessage> {
    let context = chunks
        .iter()
        .enumerate()
        .map(|(i, c)| {
            format!(
                "[片段 {}] (document_id: {})\n{}",
                i + 1,
                c.document_id,
                c.content
            )
        })
        .collect::<Vec<_>>()
        .join("\n\n");

    let system = format!(
        "你是一个知识库问答助手。请严格基于以下文档片段回答用户问题，不要编造片段之外的内容；如果片段不足以回答，请明确说明。\n\n{context}"
    );

    let mut messages = vec![ChatMessage::system(system)];
    messages.extend(history);
    messages.push(ChatMessage {
        role: Role::User,
        content: instruction.to_string(),
        images,
    });
    messages
}

fn citations_event(chunks: &[RetrievedChunk]) -> Event {
    // 返回每个命中片段的 document_id + 内容摘要（前 120 字符），供前端「引用来源」展开查看
    let citations: Vec<serde_json::Value> = chunks
        .iter()
        .map(|c| {
            serde_json::json!({
                "document_id": c.document_id,
                "snippet": c.content.chars().take(120).collect::<String>(),
            })
        })
        .collect();
    Event::default()
        .event("citations")
        .data(serde_json::json!({ "citations": citations }).to_string())
}
