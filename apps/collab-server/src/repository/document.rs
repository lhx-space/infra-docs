//! `Document.yjsState` 二进制字段的直接读写（见 design.md 决策 5：这是协议相关的底层
//! 存储，不涉及业务规则，`collab-server` 直连 Postgres，不需要走 gRPC）。
//!
//! 用 `sqlx::query`/`query_as`（运行时查询，不是 `query!` 编译期宏）——不需要在构建时
//! 连接真实数据库或维护 `.sqlx` 离线元数据，跟 CI/本地构建的解耦成本更低，代价是失去
//! 编译期 SQL 校验，但这两条查询足够简单，风险可接受。
//!
//! Prisma 的 `yjsState` 字段没有加 `@map`，落到 Postgres 里是大小写敏感的
//! `"yjsState"` 列名（见 apps/api/prisma/migrations/20260814110154_add_document_yjs_state），
//! SQL 里必须加双引号保留大小写，否则 Postgres 会把不加引号的标识符统一折叠成小写。

use sqlx::PgPool;
use uuid::Uuid;

#[derive(Debug, thiserror::Error)]
pub enum DocumentRepositoryError {
    #[error("database error: {0}")]
    Database(#[from] sqlx::Error),
    #[error("invalid document id: {0}")]
    InvalidId(#[from] uuid::Error),
}

/// 读取指定文档当前存储的 `yjsState`；返回 `None` 表示尚未做过协同初始化
/// （对应决策 6 的惰性迁移判断依据），也可能是文档本身不存在（不在这里区分，调用方
/// 已经在连接鉴权阶段——`CheckDocumentRole`——确认过文档存在，见决策 4）。
pub async fn load_yjs_state(
    pool: &PgPool,
    document_id: &str,
) -> Result<Option<Vec<u8>>, DocumentRepositoryError> {
    let id = Uuid::parse_str(document_id)?;
    let row: Option<(Option<Vec<u8>>,)> =
        sqlx::query_as(r#"SELECT "yjsState" FROM "documents" WHERE id = $1"#)
            .bind(id)
            .fetch_optional(pool)
            .await?;
    Ok(row.and_then(|(state,)| state))
}

/// 持久化最新的 `yjsState` 二进制状态（完整状态，不是增量 update）。
pub async fn save_yjs_state(
    pool: &PgPool,
    document_id: &str,
    state: &[u8],
) -> Result<(), DocumentRepositoryError> {
    let id = Uuid::parse_str(document_id)?;
    sqlx::query(r#"UPDATE "documents" SET "yjsState" = $2 WHERE id = $1"#)
        .bind(id)
        .bind(state)
        .execute(pool)
        .await?;
    Ok(())
}
