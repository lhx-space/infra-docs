import {randomUUID} from 'node:crypto';
import {Client as MinioClient} from 'minio';
import sharp from 'sharp';
import {env} from '../env';
import {logger} from '../logger';

/** 目前唯一消费方是 Wiki 封面图，但 bucket 本身不绑定具体业务场景（见 design.md 决策 3） */
const COVERS_BUCKET = 'covers';
/** 封面图只用于卡片展示，最长边超过这个值等比缩小（见 design.md 决策 9） */
const MAX_IMAGE_DIMENSION = 1600;

const minioClient = new MinioClient({
  endPoint: env.MINIO_ENDPOINT,
  port: env.MINIO_PORT,
  useSSL: false,
  accessKey: env.MINIO_ROOT_USER,
  secretKey: env.MINIO_ROOT_PASSWORD
});

/** public-read：读取（前端 <img> 直接展示）不要求鉴权，写入仍然要走 requireAuth 的上传接口（见 design.md 决策 4） */
function buildPublicReadPolicy(bucket: string): string {
  return JSON.stringify({
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Principal: {AWS: ['*']},
        Action: ['s3:GetObject'],
        Resource: [`arn:aws:s3:::${bucket}/*`]
      }
    ]
  });
}

/**
 * 启动时确保 covers bucket 存在且策略为 public-read，调用方（app.ts）只需要在服务启动时调一次。
 * 失败只记录日志不阻塞启动——本地开发场景下 MinIO 容器可能还没起来，不应该让整个 API 服务因此崩溃，
 * 真正用到上传接口时如果 bucket 没准备好会在那次请求里报错，问题会更早暴露也更好定位。
 */
export async function ensureStorageReady(): Promise<void> {
  try {
    const exists = await minioClient.bucketExists(COVERS_BUCKET);
    if (!exists) {
      await minioClient.makeBucket(COVERS_BUCKET);
    }
    await minioClient.setBucketPolicy(COVERS_BUCKET, buildPublicReadPolicy(COVERS_BUCKET));
    logger.info({bucket: COVERS_BUCKET}, 'minio bucket ready');
  } catch (err) {
    logger.error({err}, 'minio bucket setup failed');
  }
}

/**
 * 上传前统一转码为 WebP 并把最长边缩放到不超过 MAX_IMAGE_DIMENSION（见 design.md 决策 9），
 * 再写入 MinIO；返回拼接 MINIO_PUBLIC_URL 的公开 URL，读取不需要携带任何鉴权信息。
 */
export async function uploadImage(buffer: Buffer): Promise<{url: string}> {
  const webpBuffer = await sharp(buffer)
    .resize({
      width: MAX_IMAGE_DIMENSION,
      height: MAX_IMAGE_DIMENSION,
      fit: 'inside',
      withoutEnlargement: true
    })
    .webp()
    .toBuffer();

  const objectKey = `${randomUUID()}.webp`;
  await minioClient.putObject(COVERS_BUCKET, objectKey, webpBuffer, webpBuffer.length, {
    'Content-Type': 'image/webp'
  });

  return {url: `${env.MINIO_PUBLIC_URL}/${COVERS_BUCKET}/${objectKey}`};
}
