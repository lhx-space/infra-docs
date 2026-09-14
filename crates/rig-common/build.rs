/// gRPC 代码生成：从仓库根 `/protos` 编译 `ai.proto`（AiDataService）与 `collab.proto`
/// （AccessControlService，写作权限复用）。`ai-server` 是这两个服务的 gRPC client，
/// 服务端实现在 `apps/api`（TS），这里只生成 client 代码、不生成 server 代码。
fn main() -> Result<(), Box<dyn std::error::Error>> {
    tonic_build::configure()
        .build_client(true)
        .build_server(false)
        .compile_protos(
            &[
                "../../protos/ai/v1/ai.proto",
                "../../protos/collab/v1/collab.proto",
            ],
            &["../../protos/ai/v1", "../../protos/collab/v1"],
        )?;
    Ok(())
}
