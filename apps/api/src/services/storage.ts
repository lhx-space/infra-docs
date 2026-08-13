import {randomUUID} from 'node:crypto';
import {Client as MinioClient} from 'minio';
import sharp from 'sharp';
import {env} from '../env';
import {Prisma} from '../generated/prisma/client';
import {logger} from '../logger';
import {
  createUploadedObject,
  decrementUploadedObjectRefCount,
  findUploadedObjectBySha256,
  findUploadedObjectByUrl,
  incrementUploadedObjectRefCount
} from '../models/uploaded-object';
import {computeSha256} from '../utils/content-hash';

/** 目前唯一消费方是 Wiki 封面图，但 bucket 本身不绑定具体业务场景（见 design.md 决策 3） */
const COVERS_BUCKET = 'covers';
/** 封面图只用于卡片展示，最长边超过这个值等比缩小（见 design.md 决策 9） */
const MAX_IMAGE_DIMENSION = 1600;
/** 转码统一输出格式，也是落库到 `UploadedObject.mimeType` 的值——记录的是最终存储的对象格式，
 * 不是用户上传时的原始 MIME 类型 */
const WEBP_MIME_TYPE = 'image/webp';

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
 *
 * 内容寻址去重（见 image-upload-dedup design.md 决策 1~3）：先对原始上传 buffer（转码前）
 * 计算 sha256，命中已存在记录时直接复用该记录的 URL 并 `refCount + 1`，跳过转码与 MinIO
 * 写入；未命中则走原有转码流程，写入成功后新建一条 `refCount = 1` 的记录。两个几乎同时
 * 上传同一份"从未出现过"内容的请求都会各自走到"未命中→转码→尝试插入"这条路径，后到的
 * 那次插入会因 `sha256` 唯一约束冲突失败——命中 `P2002` 时不当成异常，转为按"命中"逻辑
 * 重新查询先到者的记录并自增（接受这次多余的转码/写入被直接丢弃，见 design.md 决策 3）。
 */
export async function uploadImage(buffer: Buffer): Promise<{url: string}> {
  const sha256 = computeSha256(buffer);

  const existing = await findUploadedObjectBySha256(sha256);
  if (existing) {
    await incrementUploadedObjectRefCount(existing.id);
    return {url: existing.url};
  }

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
    'Content-Type': WEBP_MIME_TYPE
  });
  const url = `${env.MINIO_PUBLIC_URL}/${COVERS_BUCKET}/${objectKey}`;

  try {
    await createUploadedObject({
      sha256,
      url,
      bucket: COVERS_BUCKET,
      objectKey,
      size: webpBuffer.length,
      mimeType: WEBP_MIME_TYPE
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const winner = await findUploadedObjectBySha256(sha256);
      if (winner) {
        await incrementUploadedObjectRefCount(winner.id);
        return {url: winner.url};
      }
    }
    throw err;
  }

  return {url};
}

/**
 * 释放对某个已上传对象的一次（或多次）引用——Wiki/Document 的封面图被替换、被清空、
 * 或其所属记录被删除时调用单次释放（见 design.md 决策 4）；正文图片按内容差量释放时
 * 传入具体次数（见 upload-reliability-hardening design.md 决策 5）。按 URL 反查：
 * 查不到时视为无操作，不抛错，覆盖"本能力上线前产生的历史对象"这类未被追踪的地址
 * （见 design.md Migration Plan）。引用计数归零时尝试物理删除对应的 MinIO 对象；删除
 * 失败只记录日志，不向上抛出、不影响调用方原本的主流程（见 design.md 决策 5）。
 */
export async function releaseImageRef(url: string, times = 1): Promise<void> {
  const record = await findUploadedObjectByUrl(url);
  if (!record) return;

  const updated = await decrementUploadedObjectRefCount(record.id, times);
  if (updated.refCount > 0) return;

  try {
    await minioClient.removeObject(updated.bucket, updated.objectKey);
  } catch (err) {
    logger.error(
      {err, bucket: updated.bucket, objectKey: updated.objectKey},
      'minio object delete failed'
    );
  }
}

/**
 * 增加对某个已上传对象的引用——正文图片按内容差量出现次数增加时调用（见
 * upload-reliability-hardening design.md 决策 5、spec.md「正文图片引用生命周期管理」，
 * 跟 `services/video.ts` 的 `acquireVideoRef` 是同一个模式）。按 URL 反查：目标对象
 * 不存在时（历史遗留、或已被清理）只记录日志，不抛出异常——这种情况下文档里会留下
 * 一个指向不存在对象的图片节点，跟视频那边"目标资产已被彻底清理"是同一类可接受的
 * 边界情况，不在这里做修复。
 */
export async function acquireImageRef(url: string, times = 1): Promise<void> {
  const record = await findUploadedObjectByUrl(url);
  if (!record) {
    logger.error({url, times}, 'acquire image ref failed: object not found');
    return;
  }
  await incrementUploadedObjectRefCount(record.id, times);
}
