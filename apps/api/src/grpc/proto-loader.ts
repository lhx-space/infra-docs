import path from 'node:path';
import {fileURLToPath} from 'node:url';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';

const currentDir = path.dirname(fileURLToPath(import.meta.url));

// /protos 是仓库根目录下多个服务共享的 gRPC 契约存放位置（见
// openspec/changes/yjs-realtime-collaboration/design.md 决策 10），不归属任何单一
// apps/*，这里用相对路径穿出 apps/api 目录引用它，跟 apps/collab-server/build.rs
// 引用同一份 .proto 文件的方式对称。
const PROTO_PATH = path.resolve(currentDir, '../../../../protos/collab/v1/collab.proto');

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
