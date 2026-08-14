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

use std::future::Future;
use std::time::Duration;

use tonic::transport::{Channel, Endpoint};

use crate::proto::collab_v1::access_control_service_client::AccessControlServiceClient;
use crate::proto::collab_v1::document_sync_service_client::DocumentSyncServiceClient;
use crate::proto::collab_v1::{
    CheckDocumentRoleRequest, GetDocumentContentRequest, SyncDocumentContentRequest, WikiRole,
};

/// 连接鉴权路径（`check_document_role`）的重试参数：这是同步等待用户建立连接的请求
/// 路径，重试次数与退避时长必须很小，不能让用户明显感知到额外等待（见
/// system-performance-hardening design.md 决策 4：2~3 次、每次几十到上百毫秒退避）。
const AUTH_RETRY_MAX_ATTEMPTS: u32 = 3;
const AUTH_RETRY_INITIAL_BACKOFF: Duration = Duration::from_millis(50);

/// 持久化路径（`GetDocumentContent`/`SyncDocumentContent`）本来就是异步周期性任务，
/// 可以承受比连接鉴权更宽松的重试策略（见 design.md 决策 4）。
const PERSIST_RETRY_MAX_ATTEMPTS: u32 = 5;
const PERSIST_RETRY_INITIAL_BACKOFF: Duration = Duration::from_millis(200);

/// 手写的指数退避重试循环，不引入 `tower::retry` 等中间件框架（见 design.md 决策 4：
/// 调用点少、失败语义也不完全一致，引入通用重试框架收益不成比例）。只在
/// `GrpcClientError::is_retryable()` 判定为暂时性失败时才重试，遇到明显不会通过重试
/// 恢复的错误（比如业务逻辑判定的失败）直接返回，不浪费重试次数。
async fn retry_with_backoff<T, F, Fut>(
    max_attempts: u32,
    initial_backoff: Duration,
    mut call: F,
) -> Result<T, GrpcClientError>
where
    F: FnMut() -> Fut,
    Fut: Future<Output = Result<T, GrpcClientError>>,
{
    let mut attempt: u32 = 0;
    let mut backoff = initial_backoff;
    loop {
        match call().await {
            Ok(value) => return Ok(value),
            Err(err) => {
                attempt += 1;
                if attempt >= max_attempts || !err.is_retryable() {
                    return Err(err);
                }
                tracing::debug!(
                    attempt,
                    max_attempts,
                    grpc_code = %err.code(),
                    "retrying grpc call after transient failure"
                );
                tokio::time::sleep(backoff).await;
                backoff *= 2;
            }
        }
    }
}

#[derive(Debug)]
pub enum GrpcClientError {
    Call(tonic::Status),
    Transport(tonic::transport::Error),
}

// 手写 `Display`/`Error`，不用 `#[derive(thiserror::Error)]` 默认给 `Call` 变体生成的
// `"grpc call failed: {0}"`——`{0}` 会调用 `tonic::Status` 自带的 `Display`，那个实现会把
// `metadata: MetadataMap { headers: {} }` 这类内部调试字段一起拼进消息里，输出一整行不方便
// 解析、对排查也没有增量价值的长字符串（本次日志优化的起因，见
// openspec/changes/system-performance-hardening design.md）。这里只保留"错误分类 + 简洁
// 消息"，跟 `apps/api` 那边 pino 对 `err` 的序释思路一致（抽取干净字段，不是整段 Debug 转储）；
// 手写之后不管是通过下面的 `code()`/`short_message()` 结构化字段记录日志，还是这个错误类型
// 被 `anyhow` 链路包装后仅靠 `Display` 打印（比如 `service::collab::RoomRegistry::get_or_create`
// 里的 `?` 传播路径），输出的都是这份干净文本，不会有第二处遗漏。
impl std::fmt::Display for GrpcClientError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            GrpcClientError::Call(status) => {
                write!(
                    f,
                    "grpc call failed: {} ({})",
                    status.message(),
                    status.code()
                )
            }
            GrpcClientError::Transport(err) => write!(f, "failed to build grpc channel: {err}"),
        }
    }
}

impl std::error::Error for GrpcClientError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            GrpcClientError::Call(status) => Some(status),
            GrpcClientError::Transport(err) => Some(err),
        }
    }
}

impl From<tonic::Status> for GrpcClientError {
    fn from(status: tonic::Status) -> Self {
        GrpcClientError::Call(status)
    }
}

impl From<tonic::transport::Error> for GrpcClientError {
    fn from(err: tonic::transport::Error) -> Self {
        GrpcClientError::Transport(err)
    }
}

impl GrpcClientError {
    /// 供日志记录用的精简错误码（见 `handler::ws`/`service::collab` 里 `tracing::error!`/
    /// `warn!` 的调用点）：作为独立的结构化日志字段（`grpc_code`），比拼进一整句 `Display`
    /// 更方便日志聚合工具按错误类型过滤/统计。
    pub fn code(&self) -> String {
        match self {
            GrpcClientError::Call(status) => status.code().to_string(),
            GrpcClientError::Transport(_) => "transport_error".to_string(),
        }
    }

    /// 精简的错误消息（不含 `tonic::Status`/`tonic::transport::Error` 的其它内部字段）。
    pub fn short_message(&self) -> String {
        match self {
            GrpcClientError::Call(status) => status.message().to_string(),
            GrpcClientError::Transport(err) => err.to_string(),
        }
    }

    /// 判断这次失败是否值得重试（见 `retry_with_backoff`）：`Transport` 一定是连接
    /// 层面的暂时性问题，值得重试；`Call` 里只挑 gRPC 语义上明确表示"暂时性、值得
    /// 重试"的几个状态码——`Unavailable`/`DeadlineExceeded`/`Aborted`/
    /// `ResourceExhausted` 是 gRPC 官方文档列出的典型可重试状态；`Unknown` 也纳入，
    /// 因为实测过 `connect_lazy()` 场景下"目标端口没有进程监听"这类传输层失败，会在
    /// 首次真实调用时被 tonic 包装成 `Call(Status::unknown("transport error"))`，
    /// 而不是构造阶段的 `Transport` 变体（见 `handler::ws` 早前排查记录）——这也是一种
    /// 值得重试的暂时性故障。其余状态码（如 `PermissionDenied`/`InvalidArgument`）属于
    /// 业务逻辑层面的明确拒绝，重试不会有不同结果，直接返回。
    fn is_retryable(&self) -> bool {
        match self {
            GrpcClientError::Transport(_) => true,
            GrpcClientError::Call(status) => matches!(
                status.code(),
                tonic::Code::Unavailable
                    | tonic::Code::DeadlineExceeded
                    | tonic::Code::Aborted
                    | tonic::Code::ResourceExhausted
                    | tonic::Code::Unknown
            ),
        }
    }
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
    /// 对暂时性失败做少量、短退避的重试（见模块顶部 `AUTH_RETRY_*` 常量的注释）。
    pub async fn check_document_role(
        &self,
        user_id: &str,
        document_id: &str,
    ) -> Result<(bool, WikiRole), GrpcClientError> {
        retry_with_backoff(AUTH_RETRY_MAX_ATTEMPTS, AUTH_RETRY_INITIAL_BACKOFF, || {
            self.check_document_role_once(user_id, document_id)
        })
        .await
    }

    async fn check_document_role_once(
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
    /// 持久化路径，用更宽松的重试参数（见模块顶部 `PERSIST_RETRY_*` 常量的注释）。
    pub async fn get_document_content(
        &self,
        document_id: &str,
    ) -> Result<Vec<u8>, GrpcClientError> {
        retry_with_backoff(
            PERSIST_RETRY_MAX_ATTEMPTS,
            PERSIST_RETRY_INITIAL_BACKOFF,
            || self.get_document_content_once(document_id),
        )
        .await
    }

    async fn get_document_content_once(
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
    /// `apps/api` 侧完成，这里只是转发当前完整的 Yjs 状态 + 最后写入者）。持久化路径，
    /// 用更宽松的重试参数（见模块顶部 `PERSIST_RETRY_*` 常量的注释）。
    pub async fn sync_document_content(
        &self,
        document_id: &str,
        yjs_state: Vec<u8>,
        last_editor_id: &str,
    ) -> Result<bool, GrpcClientError> {
        retry_with_backoff(
            PERSIST_RETRY_MAX_ATTEMPTS,
            PERSIST_RETRY_INITIAL_BACKOFF,
            || self.sync_document_content_once(document_id, yjs_state.clone(), last_editor_id),
        )
        .await
    }

    async fn sync_document_content_once(
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

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicU32, Ordering};

    use super::*;

    /// 对应 tasks.md 4.2「暂时性失败场景下调用最终能重试成功」：前两次失败，
    /// 第三次成功，验证 `retry_with_backoff` 最终拿到成功结果，且确实重试了两次。
    #[tokio::test]
    async fn retries_until_success_on_transient_failure() {
        let attempts = AtomicU32::new(0);
        let result = retry_with_backoff(5, Duration::from_millis(1), || {
            let attempts = &attempts;
            async move {
                let n = attempts.fetch_add(1, Ordering::SeqCst);
                if n < 2 {
                    Err(GrpcClientError::from(tonic::Status::unavailable(
                        "temporary",
                    )))
                } else {
                    Ok("ok")
                }
            }
        })
        .await;
        assert_eq!(result.unwrap(), "ok");
        assert_eq!(attempts.load(Ordering::SeqCst), 3);
    }

    /// 对应 tasks.md 4.3「持续失败场景下，达到最大重试次数后正确判定失败」：一直失败，
    /// 验证重试次数正好在 `max_attempts` 处停止，不多不少，且最终返回错误。
    #[tokio::test]
    async fn gives_up_after_max_attempts() {
        let attempts = AtomicU32::new(0);
        let result: Result<&str, GrpcClientError> =
            retry_with_backoff(3, Duration::from_millis(1), || {
                let attempts = &attempts;
                async move {
                    attempts.fetch_add(1, Ordering::SeqCst);
                    Err(GrpcClientError::from(tonic::Status::unavailable(
                        "still down",
                    )))
                }
            })
            .await;
        assert!(result.is_err());
        assert_eq!(attempts.load(Ordering::SeqCst), 3);
    }

    /// 明确不可重试的错误（业务逻辑拒绝，不是暂时性故障）应该直接返回，不浪费重试
    /// 次数——见 `GrpcClientError::is_retryable`。
    #[tokio::test]
    async fn does_not_retry_non_retryable_errors() {
        let attempts = AtomicU32::new(0);
        let result: Result<&str, GrpcClientError> =
            retry_with_backoff(5, Duration::from_millis(1), || {
                let attempts = &attempts;
                async move {
                    attempts.fetch_add(1, Ordering::SeqCst);
                    Err(GrpcClientError::from(tonic::Status::permission_denied(
                        "no",
                    )))
                }
            })
            .await;
        assert!(result.is_err());
        assert_eq!(attempts.load(Ordering::SeqCst), 1);
    }
}
