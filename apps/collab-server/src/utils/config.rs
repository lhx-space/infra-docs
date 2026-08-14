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
    /// `apps/api` 新增 gRPC server 的地址（见 design.md 决策 2/10）。默认用 `127.0.0.1`
    /// 而不是 `localhost`——本地调试时实测过 `localhost` 会被解析成 `::1`（IPv6），
    /// 如果 `apps/api` 只绑定了 IPv4（`0.0.0.0`），tonic 的 transport 连接会直接失败
    /// （`status: Unknown, message: "transport error"`），换成明确的 IPv4 地址消除这个
    /// 歧义；生产环境用 docker-compose 的服务名（如 `http://api:4011`）不受影响。
    ///
    /// 端口默认 `4011` 而不是更直觉的 `4001`：实测在 macOS 上 `4001` 会跟 QQ 桌面客户端
    /// 自己占用的 `127.0.0.1:4001` 撞车——两者都能同时处于 `LISTEN` 状态（`apps/api` 绑的
    /// 是通配地址 `*:4001`，QQ 绑的是精确地址 `127.0.0.1:4001`），系统会把发往
    /// `127.0.0.1:4001` 的连接优先路由给绑定更精确的 QQ，导致这里的 gRPC 调用连上一个不
    /// 认识 gRPC 协议的进程、直接报 `transport error`——现象跟"`apps/api` 没启动"一模一样，
    /// 排查时曾经因此误判（见 system-performance-hardening 相关排查记录），换成一个更
    /// 少见的端口从根上避免这类偶发冲突。
    pub api_grpc_addr: String,
    /// 周期性持久化的触发间隔（决策 7/8，Open Questions 里"具体取值待实现阶段确定"
    /// 的落地）：默认 120 秒，一个保守的初始值，先测出真实写入压力再按需调整，
    /// 不影响架构决策本身。
    pub persist_interval_secs: u64,
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
                .unwrap_or_else(|_| "http://127.0.0.1:4011".to_string()),
            persist_interval_secs: env::var("PERSIST_INTERVAL_SECS")
                .unwrap_or_else(|_| "120".to_string())
                .parse()?,
        })
    }
}
