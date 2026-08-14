//! gRPC 生成代码的挂载点（见 `build.rs`、`/protos/collab/v1/collab.proto`）。
//! `collab-server` 只作为 `AccessControlService`/`DocumentSyncService` 的客户端使用，
//! 服务端实现在 `apps/api`（TS），本模块不包含任何 server 端代码
//! （见 openspec/changes/yjs-realtime-collaboration/design.md 决策 2/10）。

pub mod collab_v1 {
    tonic::include_proto!("yjsdocs.collab.v1");
}
