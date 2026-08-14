//! `apps/api` 新增 gRPC server 的客户端封装（见 design.md 决策 2/10）。
//!
//! `collab-server` 不重新实现权限判断/内容同步这类业务规则，只通过下面两个方法调用
//! `apps/api` 已有的实现：
//! - `check_document_role`：对应 `AccessControlService.CheckDocumentRole`
//!   （连接建立时的角色鉴权，见决策 3/4）
//! - `sync_document_content` / `get_document_content`：对应 `DocumentSyncService`
//!   （持久化时的内容/版本同步，见决策 5/6/7）
//!
//! TODO（tasks.md 3.4）：接入 `tonic` 生成的客户端 stub（`crate::proto::collab_v1`），
//! 目前只是函数签名骨架，尚未建立真正的 gRPC 连接。

use crate::proto::collab_v1::WikiRole;

#[derive(Debug, thiserror::Error)]
pub enum GrpcClientError {
    #[error("grpc call failed: {0}")]
    Call(String),
}

pub struct AccessControlClient {
    #[allow(dead_code)]
    addr: String,
}

impl AccessControlClient {
    pub fn new(addr: String) -> Self {
        Self { addr }
    }

    /// 对应 `.proto` 里的 `CheckDocumentRoleRequest`/`Response`。
    /// `granted = false` 时 `role` 字段无意义，调用方（`handler::ws`）必须拒绝连接。
    pub async fn check_document_role(
        &self,
        _user_id: &str,
        _document_id: &str,
    ) -> Result<(bool, WikiRole), GrpcClientError> {
        // TODO: 用 tonic 生成的客户端发起真实调用，替换掉这个占位实现。
        Err(GrpcClientError::Call("not implemented yet".into()))
    }
}

pub struct DocumentSyncClient {
    #[allow(dead_code)]
    addr: String,
}

impl DocumentSyncClient {
    pub fn new(addr: String) -> Self {
        Self { addr }
    }

    /// 对应 `SyncDocumentContentRequest`/`Response`（决策 7：内容是否变化的判断也在
    /// `apps/api` 侧完成，这里只是转发）。
    pub async fn sync_document_content(
        &self,
        _document_id: &str,
        _content_json: &str,
    ) -> Result<bool, GrpcClientError> {
        // TODO: 接入真实调用。
        Err(GrpcClientError::Call("not implemented yet".into()))
    }

    /// 对应 `GetDocumentContentRequest`/`Response`（决策 6：存量文档惰性迁移时取回现有内容）。
    pub async fn get_document_content(
        &self,
        _document_id: &str,
    ) -> Result<String, GrpcClientError> {
        // TODO: 接入真实调用。
        Err(GrpcClientError::Call("not implemented yet".into()))
    }
}
