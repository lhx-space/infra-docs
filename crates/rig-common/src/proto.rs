//! gRPC 生成代码挂载点（见 `build.rs`、`/protos/ai/v1/ai.proto`、`/protos/collab/v1/collab.proto`）。
//! `ai-server` 作为 `AiDataService` / `AccessControlService` 的客户端使用，
//! 服务端实现在 `apps/api`（TS），本模块不包含 server 端代码。

pub mod ai_v1 {
    tonic::include_proto!("yjsdocs.ai.v1");
}

pub mod collab_v1 {
    tonic::include_proto!("yjsdocs.collab.v1");
}
