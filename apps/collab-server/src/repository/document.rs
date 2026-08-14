//! `Document.yjsState` 二进制字段的直接读写（见 design.md 决策 5：这是协议相关的底层
//! 存储，不涉及业务规则，`collab-server` 直连 Postgres，不需要走 gRPC）。
//!
//! TODO（tasks.md 3.3/3.7/3.8）：接入真实的 `sqlx` 查询，目前只是函数签名骨架。

use sqlx::PgPool;

#[derive(Debug, thiserror::Error)]
pub enum DocumentRepositoryError {
    #[error("database error: {0}")]
    Database(#[from] sqlx::Error),
}

/// 读取指定文档当前存储的 `yjsState`；`None` 表示尚未做过协同初始化
/// （对应决策 6 的惰性迁移判断依据）。
pub async fn load_yjs_state(
    _pool: &PgPool,
    _document_id: &str,
) -> Result<Option<Vec<u8>>, DocumentRepositoryError> {
    // TODO: SELECT "yjsState" FROM documents WHERE id = $1
    Ok(None)
}

/// 持久化最新的 `yjsState` 二进制状态。
pub async fn save_yjs_state(
    _pool: &PgPool,
    _document_id: &str,
    _state: &[u8],
) -> Result<(), DocumentRepositoryError> {
    // TODO: UPDATE documents SET "yjsState" = $2 WHERE id = $1
    Ok(())
}
