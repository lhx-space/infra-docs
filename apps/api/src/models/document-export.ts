import {prisma} from '../db/prisma';
import type {DocumentExport, PrismaClient} from '../generated/prisma/client';

export type {DocumentExport};

type Client = PrismaClient;

export interface CreateDocumentExportInput {
  documentId: string;
  requestedBy: string;
}

/**
 * PDF 异步导出任务的数据访问层（见 tasks.md 4.2，风格对齐 models/video-asset.ts）。
 * 目前只有 PDF 会创建记录（Markdown/Word 同步返回不落库，见 design.md 决策 7），
 * `format` 固定写 `PDF`。
 */
export function createDocumentExport(
  input: CreateDocumentExportInput,
  client: Client = prisma
): Promise<DocumentExport> {
  return client.documentExport.create({
    data: {documentId: input.documentId, requestedBy: input.requestedBy, format: 'PDF'}
  });
}

/** 状态轮询/下载路由使用；找不到返回 `null`（handler 层映射 404） */
export function findDocumentExportById(
  id: string,
  client: Client = prisma
): Promise<DocumentExport | null> {
  return client.documentExport.findUnique({where: {id}});
}

/** worker 领取任务后立刻调用（见 jobs/process-document-export-pdf.ts） */
export function markDocumentExportProcessing(
  id: string,
  client: Client = prisma
): Promise<DocumentExport> {
  return client.documentExport.update({where: {id}, data: {status: 'PROCESSING'}});
}

export function markDocumentExportReady(
  id: string,
  objectKey: string,
  client: Client = prisma
): Promise<DocumentExport> {
  return client.documentExport.update({
    where: {id},
    data: {status: 'READY', objectKey}
  });
}

/** `errorMessage` 供前端轮询展示可读的失败原因（见 spec.md「生成失败的状态反馈」） */
export function markDocumentExportFailed(
  id: string,
  errorMessage: string,
  client: Client = prisma
): Promise<DocumentExport> {
  return client.documentExport.update({
    where: {id},
    data: {status: 'FAILED', errorMessage}
  });
}

/** 定时清理入口（见 jobs/cleanup-expired-document-exports.ts）：创建时间早于
 * `maxAgeMs` 前的记录视为超期，不区分 `status`——FAILED/PENDING 的僵尸记录跟 READY
 * 的产物一样占着 `document_exports` 表，一并回收。 */
export function findExpiredDocumentExports(
  maxAgeMs: number,
  client: Client = prisma
): Promise<DocumentExport[]> {
  return client.documentExport.findMany({
    where: {createdAt: {lt: new Date(Date.now() - maxAgeMs)}}
  });
}

export function deleteDocumentExport(id: string, client: Client = prisma): Promise<DocumentExport> {
  return client.documentExport.delete({where: {id}});
}
