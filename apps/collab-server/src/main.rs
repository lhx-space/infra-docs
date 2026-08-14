mod handler;
mod middleware;
mod proto;
mod repository;
mod route;
mod service;
mod utils;

use utils::config::Config;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // 本地开发读取 .env；生产环境由容器运行时（docker-compose/K8s）直接注入环境变量，
    // 找不到 .env 文件时静默忽略，跟 apps/api 的 `--env-file` 用法保持同样的"可选"语义。
    //
    // 用 `CARGO_MANIFEST_DIR`（Cargo 编译期注入，固定指向本 crate 目录）拼出绝对路径，
    // 不用 `dotenvy::dotenv()` 默认的"从当前工作目录往上找"——`cargo run -p collab-server`
    // 如果是从 workspace 根目录执行（`make dev-collab` 就是这样），当前工作目录是根目录，
    // 找不到 apps/collab-server/.env，会直接因为缺 DATABASE_URL/JWT_SECRET 报错退出
    // （实测踩过这个坑）。换成绝对路径后，不管从哪个目录跑都能正确加载。
    let _ = dotenvy::from_path(concat!(env!("CARGO_MANIFEST_DIR"), "/.env"));

    // `RUST_LOG` 优先（Rust 生态的标准约定，支持按 module 细粒度过滤）；没设置时退回读
    // `.env` 里文档化的 `LOG_LEVEL`；两者都没有才兜底成 `info`——避免像刚才这样，日志过滤器
    // 默认级别是"什么都不显示"，看起来跟"进程没启动"没法区分。
    let log_directive = std::env::var("RUST_LOG")
        .or_else(|_| std::env::var("LOG_LEVEL"))
        .unwrap_or_else(|_| "info".to_string());
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::new(log_directive))
        .json()
        .init();

    let config = Config::from_env()?;
    tracing::info!(host = %config.host, port = config.port, "collab-server starting");

    let app_state = service::AppState::new(config.clone()).await?;
    let app = route::build_router(app_state);

    let listener = tokio::net::TcpListener::bind((config.host.as_str(), config.port)).await?;
    tracing::info!(host = %config.host, port = config.port, "collab-server listening");
    axum::serve(listener, app).await?;

    Ok(())
}
