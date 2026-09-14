//! Embedding 模型路由（见 design.md 决策 12）：embedding provider 与对话 provider 解耦。
//! v1 简化：对话走 Ollama 时 embedding 也走 Ollama，其余（openai/deepseek/anthropic）
//! 默认走 OpenAI `text-embedding-3-small`（1536 维）。
use rig_core::client::EmbeddingsClient;
use rig_core::embeddings::EmbeddingModel;
use rig_core::providers::{ollama, openai};

use crate::config::{ProviderConfig, ProviderKind};

pub enum Embedder {
    OpenAi(openai::EmbeddingModel),
    Ollama(ollama::EmbeddingModel),
}

impl Embedder {
    pub fn from_config(config: &ProviderConfig) -> anyhow::Result<Self> {
        match config.kind {
            ProviderKind::Ollama => {
                let client = match &config.base_url {
                    Some(url) => ollama::Client::builder()
                        .api_key(rig_core::client::Nothing)
                        .base_url(url.as_str())
                        .build()?,
                    None => ollama::Client::new(rig_core::client::Nothing)?,
                };
                let model = client.embedding_model_with_ndims(
                    config.embedding_model.as_str(),
                    config.embedding_ndims,
                );
                Ok(Embedder::Ollama(model))
            }
            _ => {
                let key = config.api_key.clone().unwrap_or_default();
                let client = openai::Client::new(key.as_str())?;
                let model = client.embedding_model(config.embedding_model.as_str());
                Ok(Embedder::OpenAi(model))
            }
        }
    }

    /// 批量生成 embedding，返回 `Vec<Vec<f32>>`（与 pgvector 的 `vector(1536)` 对齐；
    /// Rig 内部是 `f64`，这里降成 `f32` 落库）。
    pub async fn embed_texts(&self, texts: Vec<String>) -> anyhow::Result<Vec<Vec<f32>>> {
        let embeddings = match self {
            Embedder::OpenAi(model) => model.embed_texts(texts).await?,
            Embedder::Ollama(model) => model.embed_texts(texts).await?,
        };
        Ok(embeddings
            .into_iter()
            .map(|e| e.vec.into_iter().map(|v| v as f32).collect())
            .collect())
    }
}
