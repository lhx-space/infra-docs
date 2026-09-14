//! SSE 事件格式化工具（见 design.md 决策 2）：把流式文本增量序列化成 `data:` 帧。
//! 前端用 `fetch` + `ReadableStream` + `TextDecoder` 消费（不用 EventSource）。

/// 把一段文本增量编码成一条 SSE `data:` 帧（以 `\n\n` 结尾）。
pub fn sse_event(data: &str) -> String {
    format!("data: {}\n\n", data.replace('\n', "\\n"))
}

/// 终止一条 SSE 流。
pub fn sse_done() -> &'static str {
    "data: [DONE]\n\n"
}
