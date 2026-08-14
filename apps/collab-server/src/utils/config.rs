use std::env;

/// 运行所需的环境变量，风格对齐 `apps/api` 的 `.env` 用法（见 `apps/collab-server/.env.example`）。
#[derive(Clone)]
pub struct Config {
    pub host: String,
    pub port: u16,
    /// 与 `apps/api` 共享的同一份密钥，本地校验 access token 签名
    /// （见 design.md 决策 3：token 签名校验在 Rust 侧本地完成，不走 gRPC）。
    pub jwt_secret: String,
    /// 复用现有 Postgres（跟 `apps/api` 同一个数据库），直接读写 `Document.yjsState`
    /// （见 design.md 决策 5）。
    pub database_url: String,
    /// `apps/api` 新增 gRPC server 的地址（见 design.md 决策 2/10）。
    pub api_grpc_addr: String,
}

impl Config {
    pub fn from_env() -> anyhow::Result<Self> {
        Ok(Self {
            host: env::var("SERVER_HOST").unwrap_or_else(|_| "0.0.0.0".to_string()),
            port: env::var("SERVER_PORT")
                .unwrap_or_else(|_| "4000".to_string())
                .parse()?,
            jwt_secret: env::var("JWT_SECRET")?,
            database_url: env::var("DATABASE_URL")?,
            api_grpc_addr: env::var("API_GRPC_ADDR")
                .unwrap_or_else(|_| "http://localhost:4001".to_string()),
        })
    }
}
