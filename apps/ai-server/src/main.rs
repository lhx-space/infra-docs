//! yjs-docs AI 服务入口（见 openspec/changes/ai-assistant）：
//! 装配模型路由（ChatModel/Embedder）、RAG agent、写作 agent、gRPC client，暴露 SSE 端点，
//! 并启动后台索引任务。
mod config;
mod handler;
mod service;
mod utils;

use std::sync::Arc;

use axum::http::{Method, header};
use axum::{
    Json, Router,
    routing::{get, post},
};
use rig_common::{
    AccessControlClient, AiDataClient, ChatModel, Embedder, TranscribeModel, TtsModel,
};
use rig_editor_agent::EditorAgent;
use rig_rag_agent::RagAgent;
use serde_json::json;
use tokio::sync::Mutex;
use tower_http::cors::{Any, CorsLayer};

use config::Config;
use service::AppState;
use service::session::SessionManager;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let _ = dotenvy::from_path(concat!(env!("CARGO_MANIFEST_DIR"), "/.env"));

    let log_directive = std::env::var("RUST_LOG")
        .or_else(|_| std::env::var("LOG_LEVEL"))
        .unwrap_or_else(|_| "info".to_string());
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::new(log_directive))
        .init();

    let config = Config::from_env()?;
    tracing::info!(host = %config.host, port = config.port, "ai-server starting");

    let pool = sqlx::PgPool::connect(&config.database_url).await?;

    let chat = Arc::new(ChatModel::from_config(&config.provider)?);
    let embedder = Embedder::from_config(&config.provider)?;
    let rag = Arc::new(RagAgent::new(pool, embedder));
    let editor = Arc::new(EditorAgent::new(chat.as_ref().clone()));
    let tts = Arc::new(TtsModel::from_config(&config.provider)?);
    let tts_voice = Arc::new(config.provider.tts_voice.clone());
    let transcribe = Arc::new(TranscribeModel::from_config(&config.provider)?);
    let session = Arc::new(SessionManager::new(
        &config.redis_url,
        config.session_ttl_secs,
        config.max_context_tokens,
        6, // 保留最近 6 轮原文（决策 13 默认）
        chat.clone(),
    )?);

    let ai_data = Arc::new(Mutex::new(
        AiDataClient::connect(config.api_grpc_addr.clone()).await?,
    ));
    let access_control = Arc::new(Mutex::new(
        AccessControlClient::connect(config.api_grpc_addr.clone()).await?,
    ));

    let state = AppState {
        chat,
        editor,
        rag,
        ai_data,
        access_control,
        tts,
        tts_voice,
        transcribe,
        session,
        jwt_secret: Arc::new(config.jwt_secret.clone()),
        watermark: Arc::new(Mutex::new(String::new())),
        index_interval_secs: config.index_interval_secs,
        reconcile_interval_secs: config.reconcile_interval_secs,
    };

    service::indexer::spawn_indexer(state.clone());

    // CORS（6.6）：v1 开发放开全部来源；生产应换成具体域名白名单（见 design Open Questions）。
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods([Method::GET, Method::POST])
        .allow_headers([header::AUTHORIZATION, header::CONTENT_TYPE]);

    let app = Router::new()
        .route("/health", get(health))
        .route("/chat", post(handler::chat::chat))
        .route("/tts", post(handler::tts::tts))
        .route("/transcribe", post(handler::transcribe::transcribe))
        .layer(cors)
        .with_state(state);

    let listener = tokio::net::TcpListener::bind((config.host.as_str(), config.port)).await?;
    tracing::info!(host = %config.host, port = config.port, "ai-server listening");
    axum::serve(listener, app).await?;

    Ok(())
}

async fn health() -> Json<serde_json::Value> {
    Json(json!({ "status": "ok" }))
}
