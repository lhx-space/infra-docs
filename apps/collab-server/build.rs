/// gRPC 代码生成（见 openspec/changes/yjs-realtime-collaboration/design.md 决策 10）：
/// 从仓库根目录 `/protos` 下的 `.proto` 契约生成 Rust 客户端代码（`tonic-build`）。
/// `collab-server` 只是 `AccessControlService`/`DocumentSyncService` 的调用方（客户端），
/// 服务端实现在 `apps/api`（TS），本包不生成/不实现任何 gRPC server 代码。
fn main() -> Result<(), Box<dyn std::error::Error>> {
    tonic_build::configure()
        .build_server(false)
        .compile_protos(
            &["../../protos/collab/v1/collab.proto"],
            &["../../protos/collab/v1"],
        )?;
    Ok(())
}
