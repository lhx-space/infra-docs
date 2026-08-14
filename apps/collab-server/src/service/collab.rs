//! 协同房间管理（按 `document_id` 分组的连接集合 + 对应的 `yrs::Doc`）。
//!
//! TODO（tasks.md 3.2/3.8/3.9）：
//! - 用 `y-sync` 处理房间内每个连接的 sync/awareness 消息广播；
//! - 按防抖阈值周期性调用 `repository::document` 持久化 `yjsState`，并通过
//!   `grpc_client::DocumentSyncClient` 同步内容/版本快照（决策 7）；
//! - presence：维护每个房间当前在线的用户列表与光标/选区状态（决策见 spec.md
//!   `realtime-collaboration`「协作者 Presence 展示」）。
//!
//! 目前只是模块占位，尚未实现任何房间状态管理逻辑。
