-- pgvector 扩展 + RAG 向量表（apps/ai-server 使用，见 openspec/changes/ai-assistant）。
--
-- 由 docker-compose 的 postgres 服务在「首次初始化数据卷」时通过
-- /docker-entrypoint-initdb.d 执行；对已存在的数据卷（./.data/postgres 已有数据）
-- 不会重新执行，需手动按本文件内容执行一次（见 docker-compose.yml postgres 服务的注释）。
CREATE EXTENSION IF NOT EXISTS vector;

-- 文档分块向量表：全局一份（每篇文档按块切分多条），检索时按 wiki_id 过滤实现权限控制，
-- 跟「谁在问」无关（见 design.md 决策 9）。
-- embedding 维度必须与 AI_EMBEDDING_MODEL 一致：本地 Ollama `nomic-embed-text` = 768，
-- OpenAI `text-embedding-3-small` = 1536（切 provider 时需重建本表，见决策 12）。
CREATE TABLE IF NOT EXISTS document_chunks (
  document_id uuid NOT NULL,
  wiki_id     uuid NOT NULL,
  chunk_index integer NOT NULL,
  -- 该分块的纯文本：检索命中后回填给 LLM 的上下文原文。
  content     text NOT NULL,
  embedding   vector(768) NOT NULL,
  updated_at  timestamptz NOT NULL,
  PRIMARY KEY (document_id, chunk_index)
);

-- 余弦相似度检索索引（HNSW，pgvector 0.5+，pgvector/pgvector:pg16 内置）。
CREATE INDEX IF NOT EXISTS document_chunks_embedding_idx
  ON document_chunks USING hnsw (embedding vector_cosine_ops);

-- 按 wiki 过滤（RAG 权限过滤）的辅助索引。
CREATE INDEX IF NOT EXISTS document_chunks_wiki_idx ON document_chunks (wiki_id);
