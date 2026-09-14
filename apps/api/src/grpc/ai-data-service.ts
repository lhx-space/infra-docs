import * as grpc from '@grpc/grpc-js';
import {
  listAllDocumentIds,
  listDocumentsChangedSince as queryDocumentsChangedSince
} from '../models/document';
import {listAccessibleWikiIds} from '../models/wiki';
import type {
  ListAccessibleWikisRequest,
  ListAccessibleWikisResponse,
  ListDocumentIdsRequest,
  ListDocumentIdsResponse,
  ListDocumentsChangedSinceRequest,
  ListDocumentsChangedSinceResponse
} from './ai-proto-loader';

/** 内部错误 → gRPC 错误映射（与 document-sync-service.ts 的 mapDocumentErrorToGrpcError 同风格） */
function mapToGrpcError(err: unknown): grpc.ServiceError {
  const message = err instanceof Error ? err.message : 'internal';
  return Object.assign(new Error(message), {
    code: grpc.status.INTERNAL,
    details: message,
    metadata: new grpc.Metadata()
  });
}

/**
 * `AiDataService.ListAccessibleWikis` 实现（见 design.md 决策 9）：返回当前用户可读的
 * 全部 wikiId（WikiMember 关系 ∪ Team OWNER 兜底），供 ai-server 限定 RAG 检索范围。
 * 权限口径复用 `checkWikiAccess` 同一套规则，不在别处另写一份权限判断。
 */
export function listAccessibleWikis(
  call: grpc.ServerUnaryCall<ListAccessibleWikisRequest, ListAccessibleWikisResponse>,
  callback: grpc.sendUnaryData<ListAccessibleWikisResponse>
): void {
  listAccessibleWikiIds(call.request.userId)
    .then(wikiIds => callback(null, {wikiIds}))
    .catch((err: unknown) => callback(mapToGrpcError(err), null));
}

/**
 * `AiDataService.ListDocumentsChangedSince` 实现（决策 11）：RAG 增量重索引的数据源。
 * 纯数据枚举，不涉及用户权限——ai-server 无差别索引所有文档（向量表全局一份），
 * 权限在检索时按 wikiId 过滤（决策 9），本方法不做 user 维度的过滤。
 */
export function listDocumentsChangedSince(
  call: grpc.ServerUnaryCall<ListDocumentsChangedSinceRequest, ListDocumentsChangedSinceResponse>,
  callback: grpc.sendUnaryData<ListDocumentsChangedSinceResponse>
): void {
  const {watermark, pageSize, pageToken} = call.request;

  queryDocumentsChangedSince(watermark, pageSize, pageToken)
    .then(({documents, nextPageToken}) =>
      callback(null, {
        documents: documents.map(doc => ({
          documentId: doc.id,
          wikiId: doc.wikiId,
          title: doc.title,
          searchText: doc.searchText,
          updatedAt: doc.updatedAt.toISOString()
        })),
        nextPageToken
      })
    )
    .catch((err: unknown) => callback(mapToGrpcError(err), null));
}

/**
 * `AiDataService.ListDocumentIds` 实现（决策 11）：全量现存文档 ID 的分页枚举，
 * 供 ai-server 周期性删除对账（清理已删除文档的向量）。
 */
export function listDocumentIds(
  call: grpc.ServerUnaryCall<ListDocumentIdsRequest, ListDocumentIdsResponse>,
  callback: grpc.sendUnaryData<ListDocumentIdsResponse>
): void {
  listAllDocumentIds(call.request.pageSize, call.request.pageToken)
    .then(({ids, nextPageToken}) => callback(null, {documentIds: ids, nextPageToken}))
    .catch((err: unknown) => callback(mapToGrpcError(err), null));
}
