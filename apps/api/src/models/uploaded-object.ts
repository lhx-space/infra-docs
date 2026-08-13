import {prisma} from '../db/prisma';
import type {Prisma, PrismaClient, UploadedObject} from '../generated/prisma/client';

export type {UploadedObject};

/** 允许调用方传入事务客户端（tx），保证跨多次查询/写入的原子性；不传时默认走全局单例 */
type Client = PrismaClient | Prisma.TransactionClient;

/** 上传去重查找用：按原始文件内容的 sha256 命中已存在的对象（见 design.md 决策 1、2） */
export function findUploadedObjectBySha256(
  sha256: string,
  client: Client = prisma
): Promise<UploadedObject | null> {
  return client.uploadedObject.findUnique({where: {sha256}});
}

/** 释放引用（替换/清空封面图）用：调用方手上只有旧的 URL 字符串，按值反查（见 design.md 决策 2） */
export function findUploadedObjectByUrl(
  url: string,
  client: Client = prisma
): Promise<UploadedObject | null> {
  return client.uploadedObject.findUnique({where: {url}});
}

export interface CreateUploadedObjectInput {
  sha256: string;
  url: string;
  bucket: string;
  objectKey: string;
  size: number;
  mimeType: string;
}

/** 新内容首次上传成功后落库，`refCount` 走 schema 默认值 1，不在这里显式传入 */
export function createUploadedObject(
  input: CreateUploadedObjectInput,
  client: Client = prisma
): Promise<UploadedObject> {
  return client.uploadedObject.create({data: input});
}

/**
 * 命中去重（含并发插入冲突转自增，见 design.md 决策 3）时调用：用数据库层的 `increment`
 * 原子自增，不做"先查询再算出新值再写回"的读改写，避免并发场景下计数丢失。`by` 默认 1
 * （封面图场景永远是单次 `+1`，不用改调用点）；正文图片引用生命周期管理按内容差量传入
 * 具体次数（见 upload-reliability-hardening design.md 决策 5，跟 `models/video-asset.ts`
 * 的 `incrementVideoAssetRefCount` 是同一个模式）。
 */
export function incrementUploadedObjectRefCount(
  id: string,
  by = 1,
  client: Client = prisma
): Promise<UploadedObject> {
  return client.uploadedObject.update({
    where: {id},
    data: {refCount: {increment: by}}
  });
}

/**
 * 释放引用时调用：数据库层原子自减。返回值的 `refCount` 是否已经归零，交给调用方
 * （`services/storage.ts` 的 `releaseImageRef`）自行判断是否要触发物理删除。`by` 默认 1，
 * 同上一个函数的理由。
 */
export function decrementUploadedObjectRefCount(
  id: string,
  by = 1,
  client: Client = prisma
): Promise<UploadedObject> {
  return client.uploadedObject.update({
    where: {id},
    data: {refCount: {decrement: by}}
  });
}
