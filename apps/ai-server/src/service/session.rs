//! 会话管理与长上下文（见 design.md 决策 13）：
//! - 会话历史存 Redis（key `ai:session:{id}`，TTL + 条数上限），客户端只持 sessionId；
//! - 长上下文：token 预算 + 滚动关键要点摘要——超预算时把「滑出窗口的最旧一批消息」用
//!   LLM 增量提炼成关键要点、合并进累积摘要，保留最近 N 轮原文（不做每轮全量重总结，
//!   也不做机械截断）。
use std::sync::Arc;

use futures_util::StreamExt;
use redis::AsyncCommands;
use rig_common::{ChatMessage, ChatModel, Role};
use serde::{Deserialize, Serialize};

/// 落 Redis 的消息（serde 序列化）。system 不存历史——system 由各 agent 每次请求时
/// 重新构建（写作 = 文档上下文，问答 = 检索片段），历史只保留 user/assistant 交替。
#[derive(Debug, Clone, Serialize, Deserialize)]
struct StoredMessage {
    role: String,
    content: String,
}

/// 一个会话在 Redis 里存的内容：最近消息 + 累积的关键要点摘要（决策 13）。
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct StoredSession {
    messages: Vec<StoredMessage>,
    summary: Option<String>,
}

impl From<&ChatMessage> for StoredMessage {
    fn from(m: &ChatMessage) -> Self {
        Self {
            role: role_str(m.role),
            content: m.content.clone(),
        }
    }
}

impl From<StoredMessage> for ChatMessage {
    fn from(m: StoredMessage) -> Self {
        ChatMessage {
            role: parse_role(&m.role),
            content: m.content,
            images: Vec::new(),
        }
    }
}

fn role_str(role: Role) -> String {
    match role {
        Role::System => "system".to_string(),
        Role::User => "user".to_string(),
        Role::Assistant => "assistant".to_string(),
    }
}

fn parse_role(role: &str) -> Role {
    match role {
        "system" => Role::System,
        "assistant" => Role::Assistant,
        _ => Role::User,
    }
}

const SUMMARY_SYSTEM_PROMPT: &str = "你是对话关键要点提炼助手。只提炼对后续对话有用的关键信息：用户目标、已确认的决策、约束/偏好、待办事项、重要实体。丢弃闲聊和已过时的表述。只输出合并后的关键要点本身，不要解释、不要前缀。";

#[derive(Clone)]
pub struct SessionManager {
    client: redis::Client,
    ttl_secs: u64,
    /// 上下文 token 预算（超阈值触发滚动摘要）。
    max_tokens: usize,
    /// 保留最近 N 轮原文（其余压进累积摘要）。
    keep_recent: usize,
    /// 生成关键要点摘要用的对话模型。
    chat: Arc<ChatModel>,
}

impl SessionManager {
    pub fn new(
        redis_url: &str,
        ttl_secs: u64,
        max_tokens: usize,
        keep_recent: usize,
        chat: Arc<ChatModel>,
    ) -> anyhow::Result<Self> {
        let client = redis::Client::open(redis_url)?;
        Ok(Self {
            client,
            ttl_secs,
            max_tokens,
            keep_recent,
            chat,
        })
    }

    fn key(session_id: &str) -> String {
        format!("ai:session:{session_id}")
    }

    async fn get_session(&self, session_id: &str) -> anyhow::Result<StoredSession> {
        let mut conn = self.client.get_multiplexed_async_connection().await?;
        let raw: Option<String> = conn.get(Self::key(session_id)).await?;
        match raw {
            Some(raw) => Ok(serde_json::from_str(&raw).unwrap_or_default()),
            None => Ok(StoredSession::default()),
        }
    }

    async fn save_session(&self, session_id: &str, session: &StoredSession) -> anyhow::Result<()> {
        let mut conn = self.client.get_multiplexed_async_connection().await?;
        let raw = serde_json::to_string(session)?;
        let _: () = conn
            .set_ex(Self::key(session_id), raw, self.ttl_secs)
            .await?;
        Ok(())
    }

    /// 追加一条消息（user 或 assistant），并做条数上限兜底防无限增长。
    pub async fn append(&self, session_id: &str, message: ChatMessage) -> anyhow::Result<()> {
        let mut session = self.get_session(session_id).await?;
        session.messages.push(StoredMessage::from(&message));
        let cap = self.keep_recent.saturating_mul(4).max(50);
        if session.messages.len() > cap {
            session.messages.drain(..session.messages.len() - cap);
        }
        self.save_session(session_id, &session).await
    }

    /// 构建发给 LLM 的历史（含滚动关键要点摘要，决策 13）：
    /// - token 未超预算：直接返回「摘要 system（如有）+ 全部消息」；
    /// - 超预算：把滑出窗口的最旧一批消息用 LLM 提炼成关键要点、增量合并进累积摘要，
    ///   只保留最近 `keep_recent` 条原文，并把新摘要 + 截断后的消息持久化回 Redis。
    pub async fn build_history(&self, session_id: &str) -> anyhow::Result<Vec<ChatMessage>> {
        let mut session = self.get_session(session_id).await?;

        let total_tokens = estimate_tokens(&session.messages)
            + session.summary.as_deref().map(|s| s.len() / 4).unwrap_or(0);

        if total_tokens > self.max_tokens && session.messages.len() > self.keep_recent {
            let keep = session
                .messages
                .split_off(session.messages.len() - self.keep_recent);
            let spilled = session.messages; // 滑出窗口的最旧一批
            let merged = self.summarize(session.summary.as_deref(), &spilled).await?;
            session.summary = Some(merged);
            session.messages = keep;
            self.save_session(session_id, &session).await?;
        }

        Ok(assemble(&session))
    }

    /// 把「已有摘要 + 滑出的消息」交给 LLM 增量提炼成新的关键要点摘要。
    async fn summarize(
        &self,
        existing: Option<&str>,
        spilled: &[StoredMessage],
    ) -> anyhow::Result<String> {
        let existing_text = existing.unwrap_or("");
        let spilled_text = spilled
            .iter()
            .map(|m| format!("{}: {}", m.role, m.content))
            .collect::<Vec<_>>()
            .join("\n");

        let prompt = format!("已有摘要：\n{existing_text}\n\n新增对话：\n{spilled_text}");

        let messages = vec![
            ChatMessage::system(SUMMARY_SYSTEM_PROMPT.to_string()),
            ChatMessage::user(prompt),
        ];

        let mut stream = self.chat.stream_chat(messages).await?;
        let mut text = String::new();
        while let Some(item) = stream.next().await {
            if let Ok(chunk) = item {
                text.push_str(&chunk);
            }
        }
        Ok(text)
    }
}

fn estimate_tokens(messages: &[StoredMessage]) -> usize {
    messages.iter().map(|m| m.content.len() / 4 + 8).sum()
}

fn assemble(session: &StoredSession) -> Vec<ChatMessage> {
    let mut out = Vec::new();
    if let Some(summary) = &session.summary {
        out.push(ChatMessage::system(format!("[关键要点摘要]\n{summary}")));
    }
    out.extend(session.messages.iter().cloned().map(ChatMessage::from));
    out
}
