import {createApp} from './app';
import {env} from './env';
import {startGrpcServer} from './grpc/server';
import {logger} from './logger';
import {ensureDocumentExportStorageReady} from './services/document-export-storage';
import {ensureStorageReady} from './services/storage';
import {ensureVideoStorageReady} from './services/video-storage';

const app = createApp();

void ensureStorageReady();
void ensureVideoStorageReady();
void ensureDocumentExportStorageReady();

const server = app.listen(env.PORT, () => {
  logger.info({port: env.PORT}, 'api listening');
});

// 独立于 HTTP server 的 gRPC server（见 yjs-realtime-collaboration design.md 决策 10），
// 只服务 apps/collab-server 的内部调用。
const grpcServer = startGrpcServer();

const shutdown = (signal: string): void => {
  logger.info({signal}, 'shutting down');
  grpcServer.tryShutdown(err => {
    if (err) logger.error({err}, 'grpc server shutdown failed');
  });
  server.close(err => {
    if (err) {
      logger.error({err}, 'server.close failed');
      process.exit(1);
    }
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
