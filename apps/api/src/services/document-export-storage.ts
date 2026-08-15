import {Client as MinioClient} from 'minio';
import {env} from '../env';
import {logger} from '../logger';

/** 导出产物的独立存储前缀（见 document-export design.md 决策 8）：产物视为临时文件，
 * 由 `jobs/cleanup-expired-document-exports.ts` 定期清理，不与封面图/视频转码产物混用
 * 同一个 bucket——语义完全不同（临时导出 vs. 长期展示资源），分开更容易独立调整清理策略。
 * 保持默认私有策略：下载必须经过 `routes/document-export.ts` 的鉴权路由中转（见 spec.md
 * 「导出权限跟随文档现有读权限」），不像 `covers`/`videos` 那样是公开可直接访问的静态资源。 */
const DOCUMENT_EXPORTS_BUCKET = 'document-exports';

const minioClient = new MinioClient({
  endPoint: env.MINIO_ENDPOINT,
  port: env.MINIO_PORT,
  useSSL: false,
  accessKey: env.MINIO_ROOT_USER,
  secretKey: env.MINIO_ROOT_PASSWORD
});

/** 启动时确保 bucket 存在，风格对齐 `services/storage.ts`/`services/video-storage.ts`——
 * 失败只记录日志不阻塞启动，真正用到时如果 bucket 没准备好会在那次请求/任务里报错。 */
export async function ensureDocumentExportStorageReady(): Promise<void> {
  try {
    const exists = await minioClient.bucketExists(DOCUMENT_EXPORTS_BUCKET);
    if (!exists) await minioClient.makeBucket(DOCUMENT_EXPORTS_BUCKET);
    logger.info({bucket: DOCUMENT_EXPORTS_BUCKET}, 'document export minio bucket ready');
  } catch (err) {
    logger.error({err}, 'document export minio bucket setup failed');
  }
}

export interface UploadDocumentExportResult {
  objectKey: string;
}

/** PDF 生成成功后调用（见 jobs/process-document-export-pdf.ts）：以 `${exportId}.pdf`
 * 为 objectKey，跟 `VideoAsset` 用 `${assetId}/...` 前缀隔离产物是同一个思路，只是
 * PDF 只有单一文件，不需要目录前缀。 */
export async function uploadDocumentExportPdf(
  exportId: string,
  buffer: Buffer
): Promise<UploadDocumentExportResult> {
  const objectKey = `${exportId}.pdf`;
  await minioClient.putObject(DOCUMENT_EXPORTS_BUCKET, objectKey, buffer, buffer.length, {
    'Content-Type': 'application/pdf'
  });
  return {objectKey};
}

/** 下载路由（`GET .../download`）流式返回产物给客户端，不整体读进内存——PDF 可能是
 * 一份体积不小的文件，跟 `getObject` 返回的 Node 可读流直接对接更省内存。 */
export function getDocumentExportStream(objectKey: string): Promise<NodeJS.ReadableStream> {
  return minioClient.getObject(DOCUMENT_EXPORTS_BUCKET, objectKey);
}

/** 定时清理 job 调用，删除单个产物对象；失败只记录日志，不阻塞其余记录的清理
 * （风格对齐 `services/video-storage.ts` 的 `deleteRawVideo`）。 */
export async function deleteDocumentExportObject(objectKey: string): Promise<void> {
  try {
    await minioClient.removeObject(DOCUMENT_EXPORTS_BUCKET, objectKey);
  } catch (err) {
    logger.error({err, objectKey}, 'document export object delete failed');
  }
}
