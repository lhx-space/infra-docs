//! WS 连接鉴权（见 openspec/changes/yjs-realtime-collaboration/design.md 决策 3/4）：
//!
//! 1. 校验 access token 签名/过期时间（`utils::jwt::verify_access_token`，本地完成）；
//! 2. 用取出的 `userId` + 目标 `document_id` 调用 `AccessControlService.CheckDocumentRole`
//!    （`service::grpc_client`），拿到角色或拒绝；
//! 3. `VIEWER` → 只读连接；`EDITOR`/`OWNER` → 可写连接；`granted = false` → 拒绝连接。
//!
//! TODO（tasks.md 3.6）：在 WS 升级 handler（`handler::ws`）里接入这个流程，目前只有
//! 类型骨架，尚未连接真正的 gRPC 调用。

use crate::proto::collab_v1::WikiRole;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConnectionMode {
    ReadOnly,
    Writable,
}

impl From<WikiRole> for ConnectionMode {
    fn from(role: WikiRole) -> Self {
        match role {
            WikiRole::Viewer => ConnectionMode::ReadOnly,
            WikiRole::Editor | WikiRole::Owner => ConnectionMode::Writable,
            WikiRole::Unspecified => ConnectionMode::ReadOnly,
        }
    }
}
