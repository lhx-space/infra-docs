//! 运行所需的环境变量，风格对齐 `apps/collab-server` 的 `utils/config.rs`。
use std::env;

use rig_common::ProviderConfig;

#[derive(Clone)]
pub struct Config {
    pub host: String,
    pub port: u16,
    /// 与 `apps/api` / `apps/collab-server` 共享的同一份密钥，本地校验 access token
    /// 签名（见 design.md 决策 3）。
    pub jwt_secret: String,
    /// 复用现有 Postgres（pgvector 向量表，见 design.md 决策 12）。
    pub database_url: String,
    /// `apps/api` gRPC server 的地址（见 design.md 决策 1）。默认 `127.0.0.1:4011`，
    /// 与 collab-server 的 `API_GRPC_ADDR` 口径一致。
    pub api_grpc_addr: String,
    /// 模型路由配置（provider / model / embedding，见 design.md 决策 5/12）。
    pub provider: ProviderConfig,
    /// 增量索引轮询间隔（秒），见 design.md 决策 11 / Open Questions。
    pub index_interval_secs: u64,
    /// 删除对账间隔（秒，低频全量对账，见 design.md 决策 11）。
    pub reconcile_interval_secs: u64,
    /// 会话历史存储（Redis，见 design.md 决策 13）。
    pub redis_url: String,
    pub session_ttl_secs: u64,
    /// 上下文 token 预算（决策 13）。
    pub max_context_tokens: usize,
}

impl Config {
    pub fn from_env() -> anyhow::Result<Self> {
        Ok(Self {
            host: env::var("SERVER_HOST").unwrap_or_else(|_| "0.0.0.0".to_string()),
            port: env::var("SERVER_PORT")
                .unwrap_or_else(|_| "4100".to_string())
                .parse()?,
            jwt_secret: env::var("JWT_SECRET")?,
            database_url: env::var("DATABASE_URL")?,
            api_grpc_addr: env::var("API_GRPC_ADDR")
                .unwrap_or_else(|_| "http://127.0.0.1:4011".to_string()),
            provider: ProviderConfig::from_env()?,
            index_interval_secs: env::var("INDEX_INTERVAL_SECS")
                .unwrap_or_else(|_| "30".to_string())
                .parse()?,
            reconcile_interval_secs: env::var("RECONCILE_INTERVAL_SECS")
                .unwrap_or_else(|_| "86400".to_string())
                .parse()?,
            redis_url: env::var("REDIS_URL")
                .unwrap_or_else(|_| "redis://localhost:6379".to_string()),
            session_ttl_secs: env::var("SESSION_TTL_SECS")
                .unwrap_or_else(|_| "86400".to_string())
                .parse()?,
            max_context_tokens: env::var("MAX_CONTEXT_TOKENS")
                .unwrap_or_else(|_| "8000".to_string())
                .parse()?,
        })
    }
}
