/**
 * `/protos/collab/v1/collab.proto` 的轻量校验脚本（对应 yjs-realtime-collaboration
 * tasks.md 6.4「CI 新增校验：.proto 变更后重新生成的代码与仓库中已提交的生成产物一致」
 * 的实现阶段修正说明）：
 *
 * `apps/api` 这一侧用 `@grpc/proto-loader` 动态加载 `.proto`（见 grpc/proto-loader.ts
 * 顶部注释、tasks.md 1.2 的取舍），没有引入静态代码生成工具链——也就没有"生成产物"需要
 * 跟 `.proto` 源文件保持同步这个问题（Rust 侧同理：`tonic-build` 在 `build.rs` 里于每次
 * 构建时重新生成到 `target/`，从不提交到仓库，天然不存在漂移）。原计划的"生成产物同步"
 * 检查因此不适用；但"`.proto` 改坏了、两个服务的方法名字段名对不上"这类真实风险依然存在，
 * 只是换一种方式验证：直接尝试加载 `.proto` 并断言两个服务、每个方法都存在——这正是
 * `apps/api` gRPC server 启动时会做的同一件事，提前在 CI 里跑一次，问题在构建期就能发现，
 * 不需要等到真实起服务才暴露。
 */
import {collabProto} from '../src/grpc/proto-loader';

const REQUIRED_METHODS: Record<'AccessControlService' | 'DocumentSyncService', string[]> = {
  AccessControlService: ['CheckDocumentRole'],
  DocumentSyncService: ['SyncDocumentContent', 'GetDocumentContent']
};

let hasError = false;

for (const [serviceName, methods] of Object.entries(REQUIRED_METHODS)) {
  const service = collabProto[serviceName as keyof typeof collabProto];
  if (!service) {
    console.error(`[verify-grpc-proto] 缺少服务定义: ${serviceName}`);
    hasError = true;
    continue;
  }
  const serviceDefinition = service.service;
  for (const method of methods) {
    if (!(method in serviceDefinition)) {
      console.error(`[verify-grpc-proto] ${serviceName} 缺少方法: ${method}`);
      hasError = true;
    }
  }
}

if (hasError) {
  process.exit(1);
}

console.log('[verify-grpc-proto] /protos/collab/v1/collab.proto 校验通过');
