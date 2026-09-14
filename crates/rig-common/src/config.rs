//! 模型路由配置：从环境变量加载 provider / 模型 / embedding 配置
//! （见 openspec/changes/ai-assistant design.md 决策 5/12）。
use std::env;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProviderKind {
    OpenAi,
    Anthropic,
    DeepSeek,
    Ollama,
}

impl ProviderKind {
    fn parse(s: &str) -> Option<Self> {
        match s.to_ascii_lowercase().as_str() {
            "openai" => Some(Self::OpenAi),
            "anthropic" => Some(Self::Anthropic),
            "deepseek" => Some(Self::DeepSeek),
            "ollama" => Some(Self::Ollama),
            _ => None,
        }
    }
}

/// 对话 provider 与 embedding provider 解耦（决策 12）：embedding 默认走 OpenAI
/// `text-embedding-3-small`，对话 provider 由 `AI_PROVIDER` 决定，二者互不影响。
#[derive(Debug, Clone)]
pub struct ProviderConfig {
    pub kind: ProviderKind,
    pub api_key: Option<String>,
    pub base_url: Option<String>,
    pub model: String,
    pub embedding_model: String,
    pub embedding_ndims: usize,
    /// TTS（语音朗读）模型与音色，见 design.md 决策 15。
    pub tts_model: String,
    pub tts_voice: String,
}

impl ProviderConfig {
    pub fn from_env() -> anyhow::Result<Self> {
        let kind_str = env::var("AI_PROVIDER").unwrap_or_else(|_| "openai".to_string());
        let kind = ProviderKind::parse(&kind_str)
            .ok_or_else(|| anyhow::anyhow!("unknown AI_PROVIDER: {kind_str}"))?;

        let api_key = env::var("AI_API_KEY").ok().filter(|s| !s.is_empty());
        let base_url = env::var("AI_BASE_URL").ok().filter(|s| !s.is_empty());
        let model = env::var("AI_MODEL").unwrap_or_else(|_| default_model(kind).to_string());
        let embedding_model =
            env::var("AI_EMBEDDING_MODEL").unwrap_or_else(|_| "text-embedding-3-small".to_string());
        let embedding_ndims = env::var("AI_EMBEDDING_NDIMS")
            .unwrap_or_else(|_| "1536".to_string())
            .parse::<usize>()
            .map_err(|e| anyhow::anyhow!("invalid AI_EMBEDDING_NDIMS: {e}"))?;
        let tts_model = env::var("TTS_MODEL").unwrap_or_else(|_| "tts-1".to_string());
        let tts_voice = env::var("TTS_VOICE").unwrap_or_else(|_| "alloy".to_string());

        Ok(Self {
            kind,
            api_key,
            base_url,
            model,
            embedding_model,
            embedding_ndims,
            tts_model,
            tts_voice,
        })
    }
}

fn default_model(kind: ProviderKind) -> &'static str {
    match kind {
        ProviderKind::OpenAi => "gpt-4o-mini",
        ProviderKind::Anthropic => "claude-3-5-haiku-latest",
        ProviderKind::DeepSeek => "deepseek-chat",
        ProviderKind::Ollama => "qwen2.5:7b",
    }
}
