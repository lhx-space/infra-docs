import * as grpc from '@grpc/grpc-js';
import {checkDocumentAccess} from '../services/wiki-access';
import type {CheckDocumentRoleRequest, CheckDocumentRoleResponse} from './proto-loader';

/**
 * `AccessControlService.CheckDocumentRole` 实现（见 design.md 决策 2/4）：
 * `collab-server` 建立协同连接时调用，判断发起连接的用户对目标文档所属 Wiki 是什么角色。
 * 判断逻辑复用 `services/wiki-access.ts`（跟现有 HTTP 中间件 `requireWikiRole` 共用
 * 同一份实现），这里只负责把结果映射成 gRPC 响应——不做单独的角色权重比较，`granted`
 * 为 true 时把实际角色原样返回，由 `collab-server` 自己按角色决定连接模式（决策 4）。
 */
export function checkDocumentRole(
  call: grpc.ServerUnaryCall<CheckDocumentRoleRequest, CheckDocumentRoleResponse>,
  callback: grpc.sendUnaryData<CheckDocumentRoleResponse>
): void {
  const {userId, documentId} = call.request;

  checkDocumentAccess(documentId, userId)
    .then(access => {
      if (!access.granted) {
        // granted = false 时 role 字段无意义（见 .proto 注释），collab-server 必须
        // 拒绝该连接，不区分工作区不存在还是不是任何角色成员——等价于 REST 接口的
        // 404/403 都视为拒绝连接。
        callback(null, {granted: false, role: 'WIKI_ROLE_UNSPECIFIED'});
        return;
      }
      callback(null, {granted: true, role: access.role});
    })
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : 'internal';
      callback(
        Object.assign(new Error(message), {
          code: grpc.status.INTERNAL,
          details: message,
          metadata: new grpc.Metadata()
        }),
        null
      );
    });
}
