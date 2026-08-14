import path from 'node:path';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';

// /protos 是仓库根目录下多个服务共享的 gRPC 契约存放位置（见
// openspec/changes/yjs-realtime-collaboration/design.md 决策 10），不归属任何单一
// apps/*，这里用相对路径穿出 apps/api 目录引用它，跟 apps/collab-server/build.rs
// 引用同一份 .proto 文件的方式对称。
//
// 用 `process.cwd()` 而不是 `import.meta.url` 计算这个路径（见
// openspec/changes/system-performance-hardening design.md 决策 6/7）：生产构建换成
// 打包器（tsup）后，这个模块会被内联进 `dist/server.js`/`dist/worker.js`，`import.meta.url`
// 在打包后指向的是产物文件本身的位置，不再是这份源码原本所在的 `src/grpc/` 目录，基于它
// 反推的相对路径在打包后会算错。`process.cwd()` 更可靠——本地开发（`tsx watch`）、生产
// 运行（`node dist/server.js`，`Dockerfile` 里 `WORKDIR /repo/apps/api`）、
// `scripts/verify-grpc-proto.ts`（`pnpm --filter=@app/api verify:grpc-proto` 或直接在
// `apps/api` 目录下用 tsx 跑）这三条路径，进程的 cwd 都保证是 `apps/api/` 目录，不随
// 构建方式或调用入口变化。
const PROTO_PATH = path.resolve(process.cwd(), '../../protos/collab/v1/collab.proto');

const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
  keepCase: false,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true
});

// ---- 手写的类型定义，对应 /protos/collab/v1/collab.proto 的消息/服务形状 ----
//
// 用 `@grpc/proto-loader` 动态加载 .proto，不引入静态 TS 代码生成工具链（如
// `ts-proto`）——见 tasks.md 1.2 的取舍：调用点少（仅两个服务、几个低频方法）、协议
// 稳定，动态加载已经满足"契约只有一份来源"的目标（跟 Rust 侧 `tonic-build` 共享同一份
// .proto），不需要额外的生成步骤与随之而来的生成产物同步维护成本（对应 Rust 侧用静态
// 代码生成，是因为 `tonic` 的编译期强类型是标准用法；TS 侧动态加载 + 手写接口是同等
// 严格程度的更轻量替代）。
// 这些接口需要跟 `.proto` 手动保持一致——`.proto` 变更时记得同步更新这里。

export type WikiRoleName = 'WIKI_ROLE_UNSPECIFIED' | 'VIEWER' | 'EDITOR' | 'OWNER';

export interface CheckDocumentRoleRequest {
  userId: string;
  documentId: string;
}

export interface CheckDocumentRoleResponse {
  granted: boolean;
  role: WikiRoleName;
}

export interface SyncDocumentContentRequest {
  documentId: string;
  // proto-loader 默认把 `bytes` 字段映射成 Node `Buffer`。
  yjsState: Buffer;
  lastEditorId: string;
}

export interface SyncDocumentContentResponse {
  contentChanged: boolean;
}

export interface GetDocumentContentRequest {
  documentId: string;
}

export interface GetDocumentContentResponse {
  yjsState: Buffer;
}

interface CollabPackageDefinition {
  yjsdocs: {
    collab: {
      v1: {
        AccessControlService: grpc.ServiceClientConstructor;
        DocumentSyncService: grpc.ServiceClientConstructor;
      };
    };
  };
}

const collabPackage = grpc.loadPackageDefinition(
  packageDefinition
) as unknown as CollabPackageDefinition;

export const collabProto = collabPackage.yjsdocs.collab.v1;
