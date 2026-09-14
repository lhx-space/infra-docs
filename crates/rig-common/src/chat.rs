//! 对话模型路由（见 design.md 决策 5）：把 `ProviderConfig` 装配成统一的 `ChatModel`，
//! 对外暴露「消息列表 → 文本增量流」这一个入口，屏蔽四个 provider 的差异。
use std::pin::Pin;

use futures_util::{Stream, StreamExt};
use rig_core::client::CompletionClient;
use rig_core::completion::{CompletionError, CompletionModel, Message};
use rig_core::message::UserContent;
use rig_core::providers::{anthropic, deepseek, ollama, openai};
use rig_core::streaming::StreamedAssistantContent;

use crate::config::{ProviderConfig, ProviderKind};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Role {
    System,
    User,
    Assistant,
}

#[derive(Debug, Clone)]
pub struct ChatMessage {
    pub role: Role,
    pub content: String,
    /// 图片（base64，仅 user 消息有效），用于 vision 理解（见 design.md 决策 17）。
    pub images: Vec<String>,
}

impl ChatMessage {
    pub fn system(content: impl Into<String>) -> Self {
        Self {
            role: Role::System,
            content: content.into(),
            images: Vec::new(),
        }
    }

    pub fn user(content: impl Into<String>) -> Self {
        Self {
            role: Role::User,
            content: content.into(),
            images: Vec::new(),
        }
    }

    pub fn assistant(content: impl Into<String>) -> Self {
        Self {
            role: Role::Assistant,
            content: content.into(),
            images: Vec::new(),
        }
    }

    fn to_rig(&self) -> Message {
        match self.role {
            Role::System => Message::system(self.content.clone()),
            Role::Assistant => Message::assistant(self.content.clone()),
            Role::User if !self.images.is_empty() => {
                let mut content = vec![UserContent::text(self.content.clone())];
                for image in &self.images {
                    content.push(UserContent::image_base64(image.clone(), None, None));
                }
                Message::User { content }
            }
            Role::User => Message::user(self.content.clone()),
        }
    }
}

/// 统一的对话模型句柄：持有某个 provider 的具体 model，运行期不切换 provider，
/// 切换走配置（重启生效，见决策 5）。`Clone` 让写作/问答两条链路能共享同一个模型。
#[derive(Clone)]
pub enum ChatModel {
    OpenAi(openai::CompletionModel),
    Anthropic(anthropic::completion::CompletionModel),
    DeepSeek(deepseek::CompletionModel),
    Ollama(ollama::CompletionModel),
}

impl ChatModel {
    pub fn from_config(config: &ProviderConfig) -> anyhow::Result<Self> {
        match config.kind {
            ProviderKind::OpenAi => {
                let key = config.api_key.clone().unwrap_or_default();
                // 用 Chat Completions 客户端（`CompletionsClient`）拿 `CompletionModel`
                // （`openai::Client` 默认是 Responses API，其 `completion_model` 返回的是
                // `ResponsesCompletionModel`，类型不匹配）。
                let client = openai::CompletionsClient::new(key.as_str())?;
                Ok(ChatModel::OpenAi(
                    client.completion_model(config.model.as_str()),
                ))
            }
            ProviderKind::DeepSeek => {
                let key = config.api_key.clone().unwrap_or_default();
                let client = deepseek::Client::new(key.as_str())?;
                Ok(ChatModel::DeepSeek(
                    client.completion_model(config.model.as_str()),
                ))
            }
            ProviderKind::Anthropic => {
                let client = anthropic::Client::builder()
                    .api_key(config.api_key.clone().unwrap_or_default())
                    .build()?;
                Ok(ChatModel::Anthropic(
                    client.completion_model(config.model.as_str()),
                ))
            }
            ProviderKind::Ollama => {
                let client = match &config.base_url {
                    Some(url) => ollama::Client::builder()
                        .api_key(rig_core::client::Nothing)
                        .base_url(url.as_str())
                        .build()?,
                    None => ollama::Client::new(rig_core::client::Nothing)?,
                };
                Ok(ChatModel::Ollama(
                    client.completion_model(config.model.as_str()),
                ))
            }
        }
    }

    /// 流式对话：输入完整消息列表（最后一条是本次用户提问），输出文本增量流
    /// （`Item = Result<String, String>`，错误用字符串透传给上层）。
    pub async fn stream_chat(
        &self,
        messages: Vec<ChatMessage>,
    ) -> anyhow::Result<Pin<Box<dyn Stream<Item = Result<String, String>> + Send>>> {
        match self {
            ChatModel::OpenAi(model) => stream_text(model, messages).await,
            ChatModel::Anthropic(model) => stream_text(model, messages).await,
            ChatModel::DeepSeek(model) => stream_text(model, messages).await,
            ChatModel::Ollama(model) => stream_text(model, messages).await,
        }
    }
}

async fn stream_text<M: CompletionModel + Clone>(
    model: &M,
    messages: Vec<ChatMessage>,
) -> anyhow::Result<Pin<Box<dyn Stream<Item = Result<String, String>> + Send>>> {
    let rig_messages: Vec<Message> = messages.iter().map(ChatMessage::to_rig).collect();
    let (last, history) = match rig_messages.split_last() {
        Some((last, history)) => (last.clone(), history.to_vec()),
        None => (Message::user(String::new()), Vec::new()),
    };

    let request = model.completion_request(last).messages(history).build();
    let streaming = model.stream(request).await?;

    let stream = streaming.filter_map(
        |item: Result<StreamedAssistantContent, CompletionError>| async move {
            match item {
                Ok(StreamedAssistantContent::Text(text)) => Some(Ok(text.text)),
                Ok(_) => None, // 跳过 tool call / reasoning 等非文本内容
                Err(err) => Some(Err(err.to_string())),
            }
        },
    );

    Ok(Box::pin(stream))
}
