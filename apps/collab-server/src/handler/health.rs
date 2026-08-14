use axum::http::StatusCode;

/// 容器健康检查用（`docker-compose.yml`/K8s liveness probe），跟 `apps/api` 目前
/// 没有专门的健康检查路由不同——协同服务是长连接常驻进程，运维上更需要这个探活入口。
pub async fn healthz() -> StatusCode {
    StatusCode::OK
}
