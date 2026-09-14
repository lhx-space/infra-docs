import path from 'node:path';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';

// 与 `proto-loader.ts`（collab 契约）同一套动态加载方式：`process.cwd()` 定位到
// apps/api 目录，穿出到仓库根 /protos 引同一份 .proto（跟 ai-server 的 tonic-build
// 共享同一来源，见 openspec/changes/ai-assistant design.md 决策 1）。
const AI_PROTO_PATH = path.resolve(process.cwd(), '../../protos/ai/v1/ai.proto');

const aiPackageDefinition = protoLoader.loadSync(AI_PROTO_PATH, {
  keepCase: false,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true
});

// ---- 手写类型定义，对应 /protos/ai/v1/ai.proto 的消息形状 ----
// 与 collab 的 proto-loader.ts 同样取舍：动态加载 + 手写接口，不引入静态 TS 代码生成。
// `.proto` 变更时记得同步更新这里（字段命名已按 keepCase:false 从 snake_case 转 camelCase）。

export interface ListAccessibleWikisRequest {
  userId: string;
}

export interface ListAccessibleWikisResponse {
  wikiIds: string[];
}

export interface ListDocumentsChangedSinceRequest {
  watermark: string;
  pageSize: number;
  pageToken: string;
}

export interface DocumentRecord {
  documentId: string;
  wikiId: string;
  title: string;
  searchText: string;
  updatedAt: string;
}

export interface ListDocumentsChangedSinceResponse {
  documents: DocumentRecord[];
  nextPageToken: string;
}

export interface ListDocumentIdsRequest {
  pageSize: number;
  pageToken: string;
}

export interface ListDocumentIdsResponse {
  documentIds: string[];
  nextPageToken: string;
}

interface AiPackageDefinition {
  yjsdocs: {
    ai: {
      v1: {
        AiDataService: grpc.ServiceClientConstructor;
      };
    };
  };
}

const aiPackage = grpc.loadPackageDefinition(aiPackageDefinition) as unknown as AiPackageDefinition;

export const aiProto = aiPackage.yjsdocs.ai.v1;
