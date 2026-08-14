//! `apps/api` 新增 gRPC server 的客户端封装（见 design.md 决策 2/10）。
//!
//! `collab-server` 不重新实现权限判断/内容同步这类业务规则，只通过下面几个方法调用
//! `apps/api` 已有的实现：
//! - `check_document_role`：对应 `AccessControlService.CheckDocumentRole`
//!   （连接建立时的角色鉴权，见决策 3/4）
//! - `sync_document_content` / `get_document_content`：对应 `DocumentSyncService`
//!   （持久化时的内容/版本同步、惰性迁移取初始状态，见决策 5/6/7）
//!
//! 用 `connect_lazy()` 而不是 `connect().await`：启动时不阻塞等待 `apps/api` 的 gRPC
//! server 就绪（`docker-compose.yml` 的 `depends_on` 只保证启动顺序，不保证服务已
//! 真正监听），真实的连接建立推迟到第一次调用发生时；`apps/api` 短暂不可用时，
//! 已建立的房间/连接不受影响，只有*新的*调用会失败（见 design.md Risks，跟决策 4 的
//! 连接建立流程配合：调用失败时 `handler::ws` 拒绝新连接）。
//!
//! `tonic::Status` 本身带一些内联字段（消息、metadata 等），会让 `GrpcClientError`
//! 整体偏大，clippy 的 `result_large_err` 默认阈值会因此报警；调用频率是低频路径
//! （连接建立一次、周期性持久化一次），不是性能敏感的高频调用，用 `Box` 包一层换掉
//! 这条 lint 只会让调用方多一层解引用，收益不成比例，这里在模块级直接放行。
#![allow(clippy::result_large_err)]

use tonic::transport::{Channel, Endpoint};

use crate::proto::collab_v1::access_control_service_client::AccessControlServiceClient;
use crate::proto::collab_v1::document_sync_service_client::DocumentSyncServiceClient;
use crate::proto::collab_v1::{
    CheckDocumentRoleRequest, GetDocumentContentRequest, SyncDocumentContentRequest, WikiRole,
};

#[derive(Debug, thiserror::Error)]
pub enum GrpcClientError {
    #[error("grpc call failed: {0}")]
    Call(#[from] tonic::Status),
    #[error("failed to build grpc channel: {0}")]
    Transport(#[from] tonic::transport::Error),
}

/// 两个 gRPC 服务的客户端集合，作为 `AppState` 的一个字段（`Clone` 只是浅拷贝内部的
/// `tonic::transport::Channel`，跟克隆一个连接池句柄一样廉价，可以放心在每次请求时
/// `.clone()` 出一份可变客户端使用——tonic 生成的客户端方法要求 `&mut self`，但底层
/// `Channel` 本身是多路复用、可并发安全共享的）。
#[derive(Clone)]
pub struct GrpcClients {
    access_control: AccessControlServiceClient<Channel>,
    document_sync: DocumentSyncServiceClient<Channel>,
}

impl GrpcClients {
    pub fn connect(addr: &str) -> Result<Self, GrpcClientError> {
        let channel = Endpoint::from_shared(addr.to_string())?.connect_lazy();
        Ok(Self {
            access_control: AccessControlServiceClient::new(channel.clone()),
            document_sync: DocumentSyncServiceClient::new(channel),
        })
    }

    /// 对应 `.proto` 里的 `CheckDocumentRoleRequest`/`Response`。
    /// `granted = false` 时 `role` 字段无意义，调用方（`handler::ws`）必须拒绝连接。
    pub async fn check_document_role(
        &self,
        user_id: &str,
        document_id: &str,
    ) -> Result<(bool, WikiRole), GrpcClientError> {
        let mut client = self.access_control.clone();
        let response = client
            .check_document_role(CheckDocumentRoleRequest {
                user_id: user_id.to_string(),
                document_id: document_id.to_string(),
            })
            .await?
            .into_inner();
        let role = WikiRole::try_from(response.role).unwrap_or(WikiRole::Unspecified);
        Ok((response.granted, role))
    }

    /// 对应 `GetDocumentContentRequest`/`Response`（决策 6：存量文档惰性迁移时取回
    /// 由当前 `content` 转换出的初始 Yjs 状态，`apps/api` 侧完成转换，这里只搬运二进制）。
    pub async fn get_document_content(
        &self,
        document_id: &str,
    ) -> Result<Vec<u8>, GrpcClientError> {
        let mut client = self.document_sync.clone();
        let response = client
            .get_document_content(GetDocumentContentRequest {
                document_id: document_id.to_string(),
            })
            .await?
            .into_inner();
        Ok(response.yjs_state)
    }

    /// 对应 `SyncDocumentContentRequest`/`Response`（决策 7：内容是否变化的判断也在
    /// `apps/api` 侧完成，这里只是转发当前完整的 Yjs 状态 + 最后写入者）。
    pub async fn sync_document_content(
        &self,
        document_id: &str,
        yjs_state: Vec<u8>,
        last_editor_id: &str,
    ) -> Result<bool, GrpcClientError> {
        let mut client = self.document_sync.clone();
        let response = client
            .sync_document_content(SyncDocumentContentRequest {
                document_id: document_id.to_string(),
                yjs_state,
                last_editor_id: last_editor_id.to_string(),
            })
            .await?
            .into_inner();
        Ok(response.content_changed)
    }
}
