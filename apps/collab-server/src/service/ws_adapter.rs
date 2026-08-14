//! 把 `axum::extract::ws::WebSocket` 适配成 `y-sync`（`BroadcastGroup::subscribe_with`，
//! 见 `service::collab`）要求的 `Sink<Vec<u8>>`/`Stream<Item = Result<Vec<u8>, E>>`。
//!
//! 两者的差异只在"消息载荷类型"上（`axum::extract::ws::Message` 枚举 vs 裸
//! `Vec<u8>`）：协同同步语义下只关心二进制帧（`Message::Binary`），Text/Ping/Pong 帧
//! 直接跳过，`Close` 帧视为流结束。

use std::pin::Pin;
use std::sync::{Arc, Mutex as StdMutex};
use std::task::{Context, Poll};

use axum::extract::ws::{Message, WebSocket};
use futures_util::stream::{SplitSink, SplitStream};
use futures_util::{Sink, Stream};

/// y-sync 协议里 `Message::Sync` 大类下的子类型标签（对齐 `y_sync::sync` 模块的
/// `MSG_SYNC`/`MSG_SYNC_STEP_2`/`MSG_SYNC_UPDATE` 常量）。这两个子类型都会实际修改
/// 文档内容，用于在不完整解码整条消息的前提下，廉价识别"这是一条写入类消息"，据此
/// 记录"最后一次成功写入的用户"（见 design.md 决策 7 的实现阶段补充：
/// `DocumentVersion.createdBy` 需要一个明确作者，协同场景下没有天然的"保存请求"能
/// 携带这个信息）。这几个标签在 y-sync 协议里都是 varint 编码的小整数（0/1/2），单字节
/// 自身就是其值，不需要引入完整的 varint 解码逻辑。
const MSG_SYNC: u8 = 0;
const MSG_SYNC_STEP_2: u8 = 1;
const MSG_SYNC_UPDATE: u8 = 2;

fn is_content_update(data: &[u8]) -> bool {
    matches!(data, [MSG_SYNC, MSG_SYNC_STEP_2 | MSG_SYNC_UPDATE, ..])
}

#[derive(Debug, thiserror::Error)]
pub enum WsAdapterError {
    #[error("websocket error: {0}")]
    Axum(#[from] axum::Error),
}

pub struct WsSink {
    inner: SplitSink<WebSocket, Message>,
}

impl WsSink {
    pub fn new(inner: SplitSink<WebSocket, Message>) -> Self {
        Self { inner }
    }
}

impl Sink<Vec<u8>> for WsSink {
    type Error = WsAdapterError;

    fn poll_ready(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Result<(), Self::Error>> {
        let this = self.get_mut();
        Pin::new(&mut this.inner)
            .poll_ready(cx)
            .map_err(WsAdapterError::from)
    }

    fn start_send(self: Pin<&mut Self>, item: Vec<u8>) -> Result<(), Self::Error> {
        let this = self.get_mut();
        Pin::new(&mut this.inner)
            .start_send(Message::Binary(item))
            .map_err(WsAdapterError::from)
    }

    fn poll_flush(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Result<(), Self::Error>> {
        let this = self.get_mut();
        Pin::new(&mut this.inner)
            .poll_flush(cx)
            .map_err(WsAdapterError::from)
    }

    fn poll_close(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Result<(), Self::Error>> {
        let this = self.get_mut();
        Pin::new(&mut this.inner)
            .poll_close(cx)
            .map_err(WsAdapterError::from)
    }
}

/// 跟 [`WsSink`] 成对使用；`track_editor` 只在可写连接上传入（见 `handler::ws`），
/// 只读连接的写入本身会被 `service::collab::ReadOnlyProtocol` 拒绝应用，标记它是
/// "最后写入者"没有意义，也不应该误导审计信息。
pub struct WsStream {
    inner: SplitStream<WebSocket>,
    track_editor: Option<(Arc<StdMutex<String>>, String)>,
}

impl WsStream {
    pub fn new(
        inner: SplitStream<WebSocket>,
        track_editor: Option<(Arc<StdMutex<String>>, String)>,
    ) -> Self {
        Self {
            inner,
            track_editor,
        }
    }
}

impl Stream for WsStream {
    type Item = Result<Vec<u8>, WsAdapterError>;

    fn poll_next(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Option<Self::Item>> {
        let this = self.get_mut();
        loop {
            return match Pin::new(&mut this.inner).poll_next(cx) {
                Poll::Ready(Some(Ok(Message::Binary(data)))) => {
                    if let Some((slot, user_id)) = &this.track_editor
                        && is_content_update(&data)
                        && let Ok(mut guard) = slot.lock()
                    {
                        guard.clear();
                        guard.push_str(user_id);
                    }
                    Poll::Ready(Some(Ok(data)))
                }
                Poll::Ready(Some(Ok(Message::Close(_)))) | Poll::Ready(None) => Poll::Ready(None),
                Poll::Ready(Some(Ok(_other))) => continue, // Text/Ping/Pong：协同协议不关心
                Poll::Ready(Some(Err(e))) => Poll::Ready(Some(Err(WsAdapterError::from(e)))),
                Poll::Pending => Poll::Pending,
            };
        }
    }
}
