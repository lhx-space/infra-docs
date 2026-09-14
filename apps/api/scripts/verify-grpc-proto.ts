/**
 * `/protos/` 下 .proto 的轻量校验脚本（对应 yjs-realtime-collaboration tasks.md 6.4
 * 「CI 新增校验」的实现阶段修正说明；本次扩展覆盖 ai-assistant 新增的 `ai.proto`）：
 *
 * `apps/api` 这一侧用 `@grpc/proto-loader` 动态加载 `.proto`（见 grpc/proto-loader.ts、
 * grpc/ai-proto-loader.ts 顶部注释），没有引入静态代码生成工具链——也就没有"生成产物"
 * 需要跟 `.proto` 源文件保持同步这个问题（Rust 侧同理：`tonic-build` 在 `build.rs` 里
 * 每次构建时重新生成到 `target/`，从不提交到仓库，天然不存在漂移）。但"`.proto` 改坏了、
 * 两个服务的方法名字段名对不上"这类真实风险依然存在，直接尝试加载 `.proto` 并断言
 * 服务/方法都存在——这正是 gRPC server 启动时会做的事，提前在 CI 里跑一次即可在
 * 构建期发现问题，不需要等到真实起服务才暴露。
 */
import {aiProto} from '../src/grpc/ai-proto-loader';
import {collabProto} from '../src/grpc/proto-loader';

interface ServiceExpectation {
  proto: string;
  serviceName: string;
  service: {service: Record<string, unknown>} | undefined;
  methods: string[];
}

const EXPECTED_SERVICES: ServiceExpectation[] = [
  {
    proto: 'collab/v1/collab.proto',
    serviceName: 'AccessControlService',
    service: collabProto.AccessControlService,
    methods: ['CheckDocumentRole']
  },
  {
    proto: 'collab/v1/collab.proto',
    serviceName: 'DocumentSyncService',
    service: collabProto.DocumentSyncService,
    methods: ['SyncDocumentContent', 'GetDocumentContent']
  },
  {
    proto: 'ai/v1/ai.proto',
    serviceName: 'AiDataService',
    service: aiProto.AiDataService,
    methods: ['ListAccessibleWikis', 'ListDocumentsChangedSince', 'ListDocumentIds']
  }
];

let hasError = false;

for (const {proto, serviceName, service, methods} of EXPECTED_SERVICES) {
  if (!service?.service) {
    console.error(`[verify-grpc-proto] ${proto} 缺少服务定义: ${serviceName}`);
    hasError = true;
    continue;
  }
  for (const method of methods) {
    if (!(method in service.service)) {
      console.error(`[verify-grpc-proto] ${proto} ${serviceName} 缺少方法: ${method}`);
      hasError = true;
    }
  }
}

if (hasError) {
  process.exit(1);
}

console.log(
  '[verify-grpc-proto] /protos/collab/v1/collab.proto 与 /protos/ai/v1/ai.proto 校验通过'
);
