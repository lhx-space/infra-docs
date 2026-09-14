//! RAG agent（见 design.md 决策 9/10/11/12）：负责文档分块、embedding 生成、pgvector
//! 写入/检索、删除对账。向量表是全局一份（每篇文档按块切分），检索时才按「用户可访问
//! wikiId 集合」过滤，跟「谁在问」无关（决策 9）。
use pgvector::Vector;
use rig_common::Embedder;
use sqlx::PgPool;
use uuid::Uuid;

/// 检索命中的一个文档分块。
#[derive(Debug, Clone)]
pub struct RetrievedChunk {
    pub document_id: String,
    pub wiki_id: String,
    pub content: String,
    /// 余弦相似度（0~1，越大越相似）。
    pub score: f32,
}

/// 带引用的问答结果（`chunks` 是检索到的上下文片段，供上层喂给 LLM 并引用来源）。
#[derive(Debug, Clone)]
pub struct RetrievedContext {
    pub chunks: Vec<RetrievedChunk>,
}

pub struct RagAgent {
    pool: PgPool,
    embedder: Embedder,
}

impl RagAgent {
    pub fn new(pool: PgPool, embedder: Embedder) -> Self {
        Self { pool, embedder }
    }

    /// 索引一篇文档：分块 → embedding → upsert 到 pgvector。
    /// 重索引时按 `(document_id, chunk_index)` 幂等 upsert（决策 11「重复处理无害」）。
    pub async fn index_document(
        &self,
        document_id: &str,
        wiki_id: &str,
        title: &str,
        search_text: &str,
    ) -> anyhow::Result<()> {
        let document_uuid = Uuid::parse_str(document_id)?;
        let wiki_uuid = Uuid::parse_str(wiki_id)?;

        // v1 分块策略：整篇一段（标题 + 正文拼接）；按块分块见 design Open Questions。
        let chunks = split_chunks(title, search_text);
        let embeddings = self.embedder.embed_texts(chunks.clone()).await?;

        for (index, (chunk, embedding)) in chunks.iter().zip(embeddings).enumerate() {
            let vector = Vector::from(embedding);
            sqlx::query(
                r#"INSERT INTO document_chunks
                   (document_id, wiki_id, chunk_index, content, embedding, updated_at)
                   VALUES ($1, $2, $3, $4, $5, now())
                   ON CONFLICT (document_id, chunk_index)
                   DO UPDATE SET content = $4, embedding = $5, updated_at = now()"#,
            )
            .bind(document_uuid)
            .bind(wiki_uuid)
            .bind(index as i32)
            .bind(chunk.as_str())
            .bind(vector)
            .execute(&self.pool)
            .await?;
        }
        Ok(())
    }

    /// 向量检索：在可访问 wikiId 范围内做 top-k 余弦相似度检索。
    pub async fn retrieve(
        &self,
        query: &str,
        wiki_ids: &[String],
        limit: usize,
    ) -> anyhow::Result<RetrievedContext> {
        let mut embeddings = self.embedder.embed_texts(vec![query.to_string()]).await?;
        let query_vector = Vector::from(embeddings.pop().unwrap_or_default());

        let wiki_uuids: Vec<Uuid> = wiki_ids
            .iter()
            .filter_map(|id| Uuid::parse_str(id).ok())
            .collect();
        if wiki_uuids.is_empty() {
            return Ok(RetrievedContext { chunks: Vec::new() });
        }

        let rows: Vec<(Uuid, Uuid, String, f64)> = sqlx::query_as(
            r#"SELECT document_id, wiki_id, content, 1 - (embedding <=> $1) AS score
               FROM document_chunks
               WHERE wiki_id = ANY($2)
               ORDER BY embedding <=> $1
               LIMIT $3"#,
        )
        .bind(query_vector)
        .bind(wiki_uuids)
        .bind(limit as i64)
        .fetch_all(&self.pool)
        .await?;

        let chunks = rows
            .into_iter()
            .map(|(document_id, wiki_id, content, score)| RetrievedChunk {
                document_id: document_id.to_string(),
                wiki_id: wiki_id.to_string(),
                content,
                score: score as f32,
            })
            .collect();

        Ok(RetrievedContext { chunks })
    }

    /// 删除一篇文档的全部向量（重索引前清理旧块，或删除对账时调用）。
    pub async fn delete_document_chunks(&self, document_id: &str) -> anyhow::Result<()> {
        sqlx::query("DELETE FROM document_chunks WHERE document_id = $1")
            .bind(Uuid::parse_str(document_id)?)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    /// 列出向量表里现存的所有 document_id（删除对账用，决策 11）。
    pub async fn list_indexed_document_ids(&self) -> anyhow::Result<Vec<String>> {
        let rows: Vec<(Uuid,)> = sqlx::query_as("SELECT DISTINCT document_id FROM document_chunks")
            .fetch_all(&self.pool)
            .await?;
        Ok(rows.into_iter().map(|(id,)| id.to_string()).collect())
    }
}

/// 分块策略：v1 整篇一段（标题 + 正文拼接）。真正的按块分块（段落/标题段、重叠）见
/// design Open Questions「向量粒度」，实现阶段按真实文档长度与检索体验标定。
fn split_chunks(title: &str, search_text: &str) -> Vec<String> {
    vec![format!("{title}\n{search_text}")]
}
