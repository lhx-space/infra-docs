import * as grpc from '@grpc/grpc-js';
import {env} from '../env';
import {logger} from '../logger';
import {checkDocumentRole} from './access-control-service';
import {getDocumentContent, syncDocumentContent} from './document-sync-service';
import {collabProto} from './proto-loader';

/**
 * `apps/api` 新增的 gRPC server（见 yjs-realtime-collaboration design.md 决策 2/10）：
 * 独立端口，与现有 HTTP server（`createApp` / `env.PORT`）并存，只服务于
 * `apps/collab-server`（Rust）的内部调用，不是对外公开的 API——`apps/web` 等外部
 * 消费方继续通过现有 REST/WebSocket 访问，不受影响（见 design.md Non-Goals）。
 */
export function createGrpcServer(): grpc.Server {
  const server = new grpc.Server();

  server.addService(collabProto.AccessControlService.service, {
    CheckDocumentRole: checkDocumentRole
  });

  server.addService(collabProto.DocumentSyncService.service, {
    GetDocumentContent: getDocumentContent,
    SyncDocumentContent: syncDocumentContent
  });

  return server;
}

export function startGrpcServer(): grpc.Server {
  const server = createGrpcServer();

  server.bindAsync(`0.0.0.0:${env.GRPC_PORT}`, grpc.ServerCredentials.createInsecure(), err => {
    if (err) {
      logger.error({err}, 'grpc server failed to bind');
      return;
    }
    logger.info({port: env.GRPC_PORT}, 'grpc server listening');
  });

  return server;
}
