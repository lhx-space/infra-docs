//! 对 `apps/api` gRPC server 的客户端封装（见 design.md 决策 1）：
//! `ai-server` 不重新实现权限/文档范围这类业务规则，只通过下面两个 client 调用
//! `apps/api` 已有的实现。连接用 `connect().await`（启动时就需要拿到可用的通道，
//! 与 collab-server 的 `connect_lazy` 不同——ai-server 的索引/检索路径在启动后
//! 立即会用到，早期失败比延迟到首次调用更容易定位）。
use tonic::transport::Channel;

use crate::proto::ai_v1::ai_data_service_client::AiDataServiceClient;
use crate::proto::ai_v1::{
    DocumentRecord, ListAccessibleWikisRequest, ListDocumentIdsRequest,
    ListDocumentsChangedSinceRequest,
};
use crate::proto::collab_v1::CheckDocumentRoleRequest;
use crate::proto::collab_v1::access_control_service_client::AccessControlServiceClient;

pub struct AiDataClient {
    inner: AiDataServiceClient<Channel>,
}

impl AiDataClient {
    pub async fn connect(addr: String) -> anyhow::Result<Self> {
        let channel = Channel::from_shared(addr)?.connect().await?;
        Ok(Self {
            inner: AiDataServiceClient::new(channel),
        })
    }

    /// 当前用户可读的全部 wikiId（RAG 检索范围，决策 9）。
    pub async fn list_accessible_wikis(&mut self, user_id: String) -> anyhow::Result<Vec<String>> {
        let resp = self
            .inner
            .list_accessible_wikis(ListAccessibleWikisRequest { user_id })
            .await?;
        Ok(resp.into_inner().wiki_ids)
    }

    /// 自 watermark 以来内容有变的文档 + 下一页游标（增量重索引，决策 11）。
    pub async fn list_documents_changed_since(
        &mut self,
        watermark: String,
        page_size: i32,
        page_token: String,
    ) -> anyhow::Result<(Vec<DocumentRecord>, String)> {
        let resp = self
            .inner
            .list_documents_changed_since(ListDocumentsChangedSinceRequest {
                watermark,
                page_size,
                page_token,
            })
            .await?;
        let inner = resp.into_inner();
        Ok((inner.documents, inner.next_page_token))
    }

    /// 全量现存文档 ID + 下一页游标（删除对账，决策 11）。
    pub async fn list_document_ids(
        &mut self,
        page_size: i32,
        page_token: String,
    ) -> anyhow::Result<(Vec<String>, String)> {
        let resp = self
            .inner
            .list_document_ids(ListDocumentIdsRequest {
                page_size,
                page_token,
            })
            .await?;
        let inner = resp.into_inner();
        Ok((inner.document_ids, inner.next_page_token))
    }
}

pub struct AccessControlClient {
    inner: AccessControlServiceClient<Channel>,
}

impl AccessControlClient {
    pub async fn connect(addr: String) -> anyhow::Result<Self> {
        let channel = Channel::from_shared(addr)?.connect().await?;
        Ok(Self {
            inner: AccessControlServiceClient::new(channel),
        })
    }

    /// 用户对文档的角色判断（写作权限，决策 6/9）：复用 `apps/api` 的
    /// `checkDocumentAccess`（含 Team OWNER 兜底）。返回 `(granted, role)`，
    /// `role` 是 `WikiRole` 的 i32 值（0=UNSPECIFIED / 1=VIEWER / 2=EDITOR / 3=OWNER）。
    pub async fn check_document_role(
        &mut self,
        user_id: String,
        document_id: String,
    ) -> anyhow::Result<(bool, i32)> {
        let resp = self
            .inner
            .check_document_role(CheckDocumentRoleRequest {
                user_id,
                document_id,
            })
            .await?;
        let inner = resp.into_inner();
        Ok((inner.granted, inner.role))
    }
}
