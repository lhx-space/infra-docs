//! 后台索引任务（见 design.md 决策 11）：pull 模型增量重索引 + 周期删除对账。
//! `apps/api` 始终是唯一 gRPC server，ai-server 这里只做 client 调用，不引入反向 gRPC。
use std::collections::HashSet;
use std::time::{Duration, Instant};

use crate::service::AppState;

/// 启动后台索引循环：增量索引（短周期）+ 删除对账（长周期）。
pub fn spawn_indexer(state: AppState) {
    tokio::spawn(index_loop(state));
}

async fn index_loop(state: AppState) {
    let mut last_reconcile = Instant::now();

    loop {
        if let Err(err) = incremental_index(&state).await {
            tracing::error!(%err, "incremental index failed");
        }

        if last_reconcile.elapsed() >= Duration::from_secs(state.reconcile_interval_secs) {
            if let Err(err) = reconcile(&state).await {
                tracing::error!(%err, "reconcile failed");
            }
            last_reconcile = Instant::now();
        }

        tokio::time::sleep(Duration::from_secs(state.index_interval_secs)).await;
    }
}

/// 增量索引：从 watermark 起分页拉取变更文档，逐篇重索引（upsert 幂等，决策 11）。
async fn incremental_index(state: &AppState) -> anyhow::Result<()> {
    let watermark = state.watermark.lock().await.clone();
    let mut new_watermark = watermark.clone();
    let mut page_token = String::new();

    loop {
        let (docs, next) = {
            let mut client = state.ai_data.lock().await;
            client
                .list_documents_changed_since(watermark.clone(), 100, page_token.clone())
                .await?
        };

        for doc in &docs {
            if let Err(err) = state
                .rag
                .index_document(&doc.document_id, &doc.wiki_id, &doc.title, &doc.search_text)
                .await
            {
                tracing::error!(document_id = %doc.document_id, %err, "index document failed");
                continue;
            }
            if new_watermark.is_empty() || doc.updated_at > new_watermark {
                new_watermark = doc.updated_at.clone();
            }
        }

        if next.is_empty() {
            break;
        }
        page_token = next;
    }

    if !new_watermark.is_empty() {
        *state.watermark.lock().await = new_watermark;
    }

    Ok(())
}

/// 删除对账：对比向量表现存 document_id 与 `apps/api` 全量现存 document_id，
/// 删除「文档已被删除」的孤儿向量（Prisma 硬删除、无 tombstone，只能对账，决策 11）。
async fn reconcile(state: &AppState) -> anyhow::Result<()> {
    let mut api_ids: HashSet<String> = HashSet::new();
    let mut page_token = String::new();

    loop {
        let (ids, next) = {
            let mut client = state.ai_data.lock().await;
            client.list_document_ids(1000, page_token.clone()).await?
        };
        api_ids.extend(ids);
        if next.is_empty() {
            break;
        }
        page_token = next;
    }

    let indexed_ids = state.rag.list_indexed_document_ids().await?;
    let mut removed = 0usize;
    for id in indexed_ids {
        if !api_ids.contains(&id) {
            state.rag.delete_document_chunks(&id).await?;
            removed += 1;
        }
    }

    if removed > 0 {
        tracing::info!(removed, "reconciled stale document chunks");
    }

    Ok(())
}
