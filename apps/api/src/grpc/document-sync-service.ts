import * as grpc from '@grpc/grpc-js';
import * as documentService from '../services/document';
import type {
  GetDocumentContentRequest,
  GetDocumentContentResponse,
  SyncDocumentContentRequest,
  SyncDocumentContentResponse
} from './proto-loader';

/** `grpc.ServiceError` 是 `Error` 叠加 `StatusObject`（code/details/metadata），
 * 不能直接用普通对象字面量断言得到——需要在真实 `Error` 实例上补齐这几个字段。 */
function mapDocumentErrorToGrpcError(err: unknown): grpc.ServiceError {
  const code =
    err instanceof documentService.DocumentError && err.status === 404
      ? grpc.status.NOT_FOUND
      : grpc.status.INTERNAL;
  const message = err instanceof Error ? err.message : 'internal';
  return Object.assign(new Error(message), {
    code,
    details: message,
    metadata: new grpc.Metadata()
  });
}

/**
 * `DocumentSyncService.GetDocumentContent` 实现（见 design.md 决策 6）：存量文档惰性
 * 迁移——`collab-server` 首次为一篇 `yjsState` 为空的文档建立连接时，调用这个只读方法
 * 取回当前 `content`，用于生成初始 CRDT 状态。不重复做权限校验：调用这个方法之前，
 * `collab-server` 已经在连接建立阶段通过 `CheckDocumentRole` 校验过权限（决策 4）。
 */
export function getDocumentContent(
  call: grpc.ServerUnaryCall<GetDocumentContentRequest, GetDocumentContentResponse>,
  callback: grpc.sendUnaryData<GetDocumentContentResponse>
): void {
  documentService
    .getDocumentContentForCollab(call.request.documentId)
    .then(yjsState => callback(null, {yjsState}))
    .catch((err: unknown) => callback(mapDocumentErrorToGrpcError(err), null));
}

/**
 * `DocumentSyncService.SyncDocumentContent` 实现（见 design.md 决策 5/7）：
 * `collab-server` 周期性持久化 `yjsState` 时调用，同步 `content`/`searchText` 并按
 * 需要追加版本快照，具体逻辑见 `services/document.ts` 的 `syncContentFromCollab`
 * （内容是否变化的判断也在这里完成，`collab-server` 不需要自己维护上一次内容的状态）。
 */
export function syncDocumentContent(
  call: grpc.ServerUnaryCall<SyncDocumentContentRequest, SyncDocumentContentResponse>,
  callback: grpc.sendUnaryData<SyncDocumentContentResponse>
): void {
  const {documentId, yjsState, lastEditorId} = call.request;

  documentService
    .syncContentFromCollab(documentId, yjsState, lastEditorId)
    .then(({contentChanged}) => callback(null, {contentChanged}))
    .catch((err: unknown) => callback(mapDocumentErrorToGrpcError(err), null));
}
