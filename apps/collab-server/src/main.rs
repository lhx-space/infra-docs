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

    // 把 `log` crate facade 的日志记录（部分第三方依赖内部用这套，不是 `tracing`）桥接进
    // `tracing` 的订阅者管线——`tracing_subscriber::fmt()...init()` 默认就带这份桥接
    // （"tracing-log" 是它的默认 feature），不需要（也不能）再手动调一次
    // `tracing_log::LogTracer::init()`：两边都想拿 `log` crate 全局唯一的那个 logger 注册槛
    // 位，手动调用会跟 `fmt().init()` 内部已经做的注册撞车，直接 panic（`SetLoggerError`，
    // 实测踩过这个坑）。
    let is_production = std::env::var("APP_ENV")
        .map(|v| v == "production")
        .unwrap_or(false);
    let env_filter = tracing_subscriber::EnvFilter::new(log_directive);
    if is_production {
        // `flatten_event(true)`：把 `tracing::info!(a = 1, "msg")` 里的 `a`/消息本身直接
        // 拍平到 JSON 顶层字段（`{"a":1,"message":"msg",...}`），而不是嵌套在默认的
        // `{"fields":{"a":1,"message":"msg"},...}` 结构里——跟 `apps/api` 那边 pino 输出的
        // 扁平字段风格（`{"level":30,"msg":"...","port":3000,...}`）保持一致，方便同一套
        // 日志采集/检索规则同时适配 Node 和 Rust 这两个服务，不需要为 Rust 这边单独写一套
        // "先展开 fields 再解析"的规则。
        tracing_subscriber::fmt()
            .with_env_filter(env_filter)
            .json()
            .flatten_event(true)
            .init();
    } else {
        tracing_subscriber::fmt()
            .with_env_filter(env_filter)
            .pretty()
            .init();
    }

    let config = Config::from_env()?;
    tracing::info!(host = %config.host, port = config.port, "collab-server starting");

    let app_state = service::AppState::new(config.clone()).await?;
    let app = route::build_router(app_state);

    let listener = tokio::net::TcpListener::bind((config.host.as_str(), config.port)).await?;
    tracing::info!(host = %config.host, port = config.port, "collab-server listening");
    axum::serve(listener, app).await?;

    Ok(())
}
