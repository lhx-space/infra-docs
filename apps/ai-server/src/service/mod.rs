pub mod indexer;
pub mod session;

use std::sync::Arc;

use rig_common::{AccessControlClient, AiDataClient, ChatModel, TranscribeModel, TtsModel};
use rig_editor_agent::EditorAgent;
use rig_rag_agent::RagAgent;
use session::SessionManager;
use tokio::sync::Mutex;

/// Axum 共享状态（见 design.md 决策 1/6/9/11）：
/// - `chat` / `editor` / `rag`：对话模型、写作 agent、RAG agent（共享同一个 ChatModel）；
/// - `ai_data` / `access_control`：对 `apps/api` 的 gRPC client（Mutex 包装，因为 tonic
///   的调用需要 `&mut self`）；
/// - `watermark`：增量索引游标（内存态，重启后从 epoch 全量重扫，见决策 11）。
#[derive(Clone)]
pub struct AppState {
    pub chat: Arc<ChatModel>,
    pub editor: Arc<EditorAgent>,
    pub rag: Arc<RagAgent>,
    pub ai_data: Arc<Mutex<AiDataClient>>,
    pub access_control: Arc<Mutex<AccessControlClient>>,
    pub tts: Arc<TtsModel>,
    pub tts_voice: Arc<String>,
    pub transcribe: Arc<TranscribeModel>,
    pub session: Arc<SessionManager>,
    pub jwt_secret: Arc<String>,
    pub watermark: Arc<Mutex<String>>,
    pub index_interval_secs: u64,
    pub reconcile_interval_secs: u64,
}
