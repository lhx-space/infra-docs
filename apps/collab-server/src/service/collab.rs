//! 协同房间管理（按 `document_id` 分组的连接集合 + 对应的 `yrs::Doc`，见 design.md
//! 决策 1/4/5/6/7/8）。

use std::collections::HashMap;
use std::sync::{Arc, Mutex as StdMutex};
use std::time::Duration;

use tokio::sync::RwLock;
use tokio::task::JoinHandle;
use y_sync::awareness::Awareness;
use y_sync::net::BroadcastGroup;
use y_sync::sync::{Error as SyncError, Message as SyncMessage, Protocol};
use yrs::updates::decoder::Decode;
use yrs::{Doc, ReadTxn, StateVector, Transact, Update};

use crate::repository;
use crate::service::circuit_breaker::CircuitBreaker;
use crate::service::grpc_client::GrpcClients;

/// `VIEWER` 连接使用的协议：继承 `DefaultProtocol` 的其它行为（sync-step1 应答、
/// awareness 广播），只覆盖会修改文档内容的两个方法，让它们变成无操作——见
/// realtime-collaboration spec.md「VIEWER 建立只读连接」：可以接收广播，但服务端拒绝
/// 其写入的更新（连接本身仍然建立成功，只是任何写入类消息被静默丢弃，不回任何错误，
/// 跟只读语义一致，不需要额外提示客户端"这条被拒绝了"）。
pub struct ReadOnlyProtocol;

impl Protocol for ReadOnlyProtocol {
    fn handle_sync_step2(
        &self,
        _awareness: &mut Awareness,
        _update: Update,
    ) -> Result<Option<SyncMessage>, SyncError> {
        Ok(None)
    }

    fn handle_update(
        &self,
        _awareness: &mut Awareness,
        _update: Update,
    ) -> Result<Option<SyncMessage>, SyncError> {
        Ok(None)
    }
}

/// 一个协同房间：对应一篇正在被协同编辑的文档，`document_id` 是房间标识（决策 4，
/// 直接用 `Document.id`）。
pub struct Room {
    pub document_id: String,
    pub broadcast: BroadcastGroup,
    /// 最近一次成功应用写入的用户 ID（由 `service::ws_adapter::WsStream` 在收到可写
    /// 连接的内容更新消息时更新），周期性持久化时作为 `DocumentVersion.createdBy`
    /// 传给 `apps/api`（决策 7）。初始为空字符串——房间刚创建、还没有任何写入时，
    /// 第一次持久化 tick 如果恰好赶在首个写入之前触发，会带着空字符串调用
    /// `SyncDocumentContent`，`apps/api` 侧遇到空值会跳过版本快照（只同步内容），
    /// 这是预期行为，不是 bug。
    pub last_editor_id: Arc<StdMutex<String>>,
}

/// 按 `document_id` 索引的房间集合 + 周期性持久化的触发间隔。
///
/// **已知的简化点（后续可优化，不影响本次功能正确性）**：房间一旦创建，对应的周期性
/// 持久化任务（`spawn_persistence_task`）会一直运行，即使该文档的所有连接都已断开——
/// 没有实现"引用计数归零后清理房间 + 停止持久化任务"。这意味着长期运行的进程里，
/// 曾被打开过的文档数量会转化为等量的常驻定时任务，量级增长后需要补一次清理机制
/// （可以在 `BroadcastGroup`/`Subscription` 之上加一层连接计数）。
pub struct RoomRegistry {
    rooms: RwLock<HashMap<String, Arc<Room>>>,
    persist_interval: Duration,
    /// 跟连接鉴权路径（`handler::ws::upgrade`）共用的同一个熔断信号实例（见
    /// `service::AppState` 顶部注释）——持久化任务只上报成功/失败，不会因为熔断开启
    /// 就跳过尝试（它自己有独立的快速重试节奏，见 `spawn_persistence_task`）。
    circuit_breaker: Arc<CircuitBreaker>,
}

impl RoomRegistry {
    pub fn new(persist_interval: Duration, circuit_breaker: Arc<CircuitBreaker>) -> Self {
        Self {
            rooms: RwLock::new(HashMap::new()),
            persist_interval,
            circuit_breaker,
        }
    }

    /// 取得（或首次创建）指定文档的房间。首次创建时：
    /// 1. 从 Postgres 读取已有的 `yjsState`（`repository::document::load_yjs_state`）；
    /// 2. 为空则说明是存量文档、从未协同初始化过（决策 6），调用 gRPC
    ///    `GetDocumentContent` 取回由当前 `content` 转换出的初始状态并立即持久化，
    ///    保证同一文档的后续并发连接直接读到已初始化的状态，不会重复触发迁移；
    /// 3. 用还原出的 `yrs::Doc` 建一个 `BroadcastGroup`，并 spawn 一个周期性持久化任务。
    pub async fn get_or_create(
        &self,
        document_id: &str,
        db: &sqlx::PgPool,
        grpc: &GrpcClients,
    ) -> anyhow::Result<Arc<Room>> {
        if let Some(room) = self.rooms.read().await.get(document_id) {
            return Ok(room.clone());
        }

        // 写锁内二次检查：避免同一文档的并发首次连接各自重复触发一次惰性迁移
        // （两次都读到 yjsState 为空，都各自转换一次初始状态并持久化，后写的会覆盖
        // 先写的——不会造成数据损坏，但会有一次浪费的 gRPC 调用，这里直接避免掉）。
        let mut rooms = self.rooms.write().await;
        if let Some(room) = rooms.get(document_id) {
            return Ok(room.clone());
        }

        let doc = Doc::new();
        let existing_state = repository::document::load_yjs_state(db, document_id).await?;
        match existing_state {
            Some(state) => {
                let update = Update::decode_v1(&state)
                    .map_err(|e| anyhow::anyhow!("failed to decode yjsState: {e}"))?;
                doc.transact_mut().apply_update(update);
            }
            None => {
                let initial = grpc.get_document_content(document_id).await?;
                if !initial.is_empty() {
                    let update = Update::decode_v1(&initial)
                        .map_err(|e| anyhow::anyhow!("failed to decode initial yjs state: {e}"))?;
                    doc.transact_mut().apply_update(update);
                }
                let encoded = doc
                    .transact()
                    .encode_state_as_update_v1(&StateVector::default());
                repository::document::save_yjs_state(db, document_id, &encoded).await?;
            }
        }

        let awareness = Arc::new(RwLock::new(Awareness::new(doc)));
        let broadcast = BroadcastGroup::new(awareness, 64).await;
        let room = Arc::new(Room {
            document_id: document_id.to_string(),
            broadcast,
            last_editor_id: Arc::new(StdMutex::new(String::new())),
        });

        spawn_persistence_task(
            room.clone(),
            db.clone(),
            grpc.clone(),
            self.persist_interval,
            self.circuit_breaker.clone(),
        );

        rooms.insert(document_id.to_string(), room.clone());
        Ok(room)
    }
}

/// 周期性持久化（决策 7/8）：每隔 `interval` 编码一次当前完整状态，写入 Postgres，
/// 并通过 gRPC 交给 `apps/api` 同步 `content`/`searchText` + 版本快照。触发是无条件
/// 定时的（不做"脏检查"判断是否真的有变化）——`apps/api` 侧的 `SyncDocumentContent`
/// 已经会判断内容是否真的变化（`content_changed`），避免产生冗余版本记录（见
/// document-versioning spec.md「版本快照避免因周期性持久化产生冗余记录」），这里
/// 重复判断没有必要，简单可靠优先。
///
/// 失败后的重试节奏（见 collab-server-resilience spec.md「周期性持久化失败的快速
/// 重试」、system-performance-hardening design.md 决策 6）：一轮失败后不再机械等待
/// 完整的 `interval`，改用远短于它的 `fast_retry_delay` 尽快重试；但连续多轮都失败时
/// 不无限缩短/维持这个高频重试——超过 `MAX_FAST_RETRIES` 轮后退回正常的 `interval`
/// 继续尝试，避免持续故障期间对本地数据库/`apps/api` 造成不必要的高频压力。一次成功
/// 就重置计数器、恢复到"下一次失败也能快速重试"的状态。
fn spawn_persistence_task(
    room: Arc<Room>,
    db: sqlx::PgPool,
    grpc: GrpcClients,
    interval: Duration,
    circuit_breaker: Arc<CircuitBreaker>,
) -> JoinHandle<()> {
    // 取正常周期的 1/8，并设一个 5 秒的绝对下限——避免 `persist_interval_secs` 配置得
    //很小时这个值退化到几乎无意义的高频重试；同时不超过正常周期本身（`interval` 本来
    // 就很短时，快速重试没有意义）。保守取值，标注为后续可依据真实运行数据调整（见
    // design.md 决策——延续跟熔断阈值一致的取向）。
    let fast_retry_delay = (interval / 8).max(Duration::from_secs(5)).min(interval);
    /// 连续快速重试多少轮后放弃"尽快重试"、退回正常周期（见 spec.md「多轮持续失败后
    /// 恢复正常周期」）。
    const MAX_FAST_RETRIES: u32 = 3;

    tokio::spawn(async move {
        let mut consecutive_failures: u32 = 0;
        tokio::time::sleep(interval).await; // 第一次沿用原来的行为：跳过立即触发，从下一个完整周期开始持久化
        loop {
            let succeeded = run_persistence_round(&room, &db, &grpc, &circuit_breaker).await;
            let next_delay = if succeeded {
                consecutive_failures = 0;
                interval
            } else {
                consecutive_failures += 1;
                if consecutive_failures <= MAX_FAST_RETRIES {
                    fast_retry_delay
                } else {
                    interval
                }
            };
            tokio::time::sleep(next_delay).await;
        }
    })
}

/// 单轮持久化：编码当前状态 → 写本地 Postgres → 通过 gRPC 同步给 `apps/api`。返回
/// `true` 表示整轮成功，`false` 表示任一步骤失败（调用方据此决定下一轮等待多久）。
async fn run_persistence_round(
    room: &Arc<Room>,
    db: &sqlx::PgPool,
    grpc: &GrpcClients,
    circuit_breaker: &Arc<CircuitBreaker>,
) -> bool {
    let state = {
        let awareness = room.broadcast.awareness().read().await;
        awareness
            .doc()
            .transact()
            .encode_state_as_update_v1(&StateVector::default())
    };

    if let Err(err) = repository::document::save_yjs_state(db, &room.document_id, &state).await {
        tracing::error!(document_id = %room.document_id, %err, "failed to persist yjsState");
        return false;
    }

    let last_editor_id = room
        .last_editor_id
        .lock()
        .map(|guard| guard.clone())
        .unwrap_or_default();

    match grpc
        .sync_document_content(&room.document_id, state, &last_editor_id)
        .await
    {
        Ok(_) => {
            circuit_breaker.on_success();
            true
        }
        Err(err) => {
            circuit_breaker.on_failure();
            tracing::warn!(
                document_id = %room.document_id,
                grpc_code = %err.code(),
                grpc_message = %err.short_message(),
                "sync_document_content grpc call failed"
            );
            false
        }
    }
}
