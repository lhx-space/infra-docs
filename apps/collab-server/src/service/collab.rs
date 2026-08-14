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
}

impl RoomRegistry {
    pub fn new(persist_interval: Duration) -> Self {
        Self {
            rooms: RwLock::new(HashMap::new()),
            persist_interval,
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
fn spawn_persistence_task(
    room: Arc<Room>,
    db: sqlx::PgPool,
    grpc: GrpcClients,
    interval: Duration,
) -> JoinHandle<()> {
    tokio::spawn(async move {
        let mut ticker = tokio::time::interval(interval);
        ticker.tick().await; // 第一次 tick 立即触发，跳过它，从下一个完整周期开始持久化
        loop {
            ticker.tick().await;

            let state = {
                let awareness = room.broadcast.awareness().read().await;
                awareness
                    .doc()
                    .transact()
                    .encode_state_as_update_v1(&StateVector::default())
            };

            if let Err(err) =
                repository::document::save_yjs_state(&db, &room.document_id, &state).await
            {
                tracing::error!(document_id = %room.document_id, %err, "failed to persist yjsState");
                continue;
            }

            let last_editor_id = room
                .last_editor_id
                .lock()
                .map(|guard| guard.clone())
                .unwrap_or_default();

            if let Err(err) = grpc
                .sync_document_content(&room.document_id, state, &last_editor_id)
                .await
            {
                tracing::warn!(
                    document_id = %room.document_id,
                    %err,
                    "sync_document_content grpc call failed"
                );
            }
        }
    })
}
