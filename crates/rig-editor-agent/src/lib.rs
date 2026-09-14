//! 写作 agent（见 design.md 决策 6）：输入「当前文档上下文 + 用户指令」，输出流式文案。
//! 编辑器状态在客户端（`Y.Doc`），本 agent 只产出内容；「插入 / 替换」由前端编辑器桥
//! 决定（用户在面板审阅后点应用）。结构化编辑动作（insert/replace_selection）作为
//! 后续扩展位保留，v1 前端用「是否选中」推断动作（决策 7）。
use std::pin::Pin;

use futures_util::Stream;
use rig_common::{ChatMessage, ChatModel, Role};

/// 写作请求的文档上下文（客户端组装，见 decision 6：只取标题 + 选区/光标附近切片）。
#[derive(Debug, Clone)]
pub struct EditorContext {
    pub document_title: String,
    /// 用户当前选中的文本（有则视为「改写/润色/翻译」类意图）。
    pub selected_text: Option<String>,
    /// 光标附近的上下文切片（生成/续写用）。
    pub context_slice: Option<String>,
    /// 用户指令（如「把这段翻译成英文」「帮我写一段关于 X 的介绍」）。
    pub instruction: String,
    /// 随消息附带的图片（base64），用于 vision 理解（决策 17）。
    pub images: Vec<String>,
}

pub struct EditorAgent {
    model: ChatModel,
}

impl EditorAgent {
    pub fn new(model: ChatModel) -> Self {
        Self { model }
    }

    /// 生成内容：返回文本增量流（`Item = Result<String, String>`）。
    /// `history` 是本会话此前的 user/assistant 消息（不含 system，system 每次重构建）。
    /// 依赖方向：未来要「参考其他文档写这段」时可调用 `rig-rag-agent` 的 `retrieve`
    /// 拿到额外上下文拼进 system prompt（决策 4，v1 不强制接入）。
    pub async fn generate(
        &self,
        context: EditorContext,
        history: Vec<ChatMessage>,
    ) -> anyhow::Result<Pin<Box<dyn Stream<Item = Result<String, String>> + Send>>> {
        let system = build_system_prompt(&context);
        let mut messages = vec![ChatMessage::system(system)];
        messages.extend(history);
        messages.push(ChatMessage {
            role: Role::User,
            content: context.instruction,
            images: context.images.clone(),
        });
        self.model.stream_chat(messages).await
    }
}

fn build_system_prompt(context: &EditorContext) -> String {
    let mut parts = vec![
        "你是一个 Wiki 文档写作助手。根据用户指令执行以下操作之一，并只输出结果正文内容本身（不要解释、不要前缀、不要额外说明）：".to_string(),
        "- 生成：从无到有写一段内容；\n- 续写：接着已有内容往下写；\n- 润色：改写得更流畅/专业，不改变原意；\n- 翻译：翻译成目标语言（未指定时中文↔英文）；\n- 总结：压缩成要点；\n- 扩写：在原有基础上补充细节；\n- 缩写：删减冗余、保留核心。".to_string(),
        format!("当前文档标题：{}", context.document_title),
    ];

    if let Some(selected) = &context.selected_text {
        parts.push(format!(
            "用户选中的文本（针对它的指令默认是改写/润色/翻译/总结/扩写/缩写，而非凭空生成）：\n{selected}"
        ));
    }
    if let Some(slice) = &context.context_slice {
        parts.push(format!("光标附近的上下文（续写/生成时参考）：\n{slice}"));
    }

    parts.join("\n\n")
}
