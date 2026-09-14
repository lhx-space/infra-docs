//! yjs-docs AI 服务公共层（见 openspec/changes/ai-assistant design.md 决策 4）：
//! 模型路由（chat + embedding）、SSE 流式工具、gRPC client 装配。`rig-rag-agent` /
//! `rig-editor-agent` 与 `apps/ai-server` 都依赖本 crate。

mod chat;
mod config;
mod embed;
mod grpc;
mod proto;
mod sse;
mod transcribe;
mod tts;

pub use chat::{ChatMessage, ChatModel, Role};
pub use config::{ProviderConfig, ProviderKind};
pub use embed::Embedder;
pub use grpc::{AccessControlClient, AiDataClient};
pub use proto::{ai_v1, collab_v1};
pub use sse::{sse_done, sse_event};
pub use transcribe::TranscribeModel;
pub use tts::TtsModel;
