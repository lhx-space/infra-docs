import type {NextFunction, Request, Response} from 'express';
import {z} from 'zod';
import {logger} from '../logger';
import {createDocumentExport, findDocumentExportById} from '../models/document-export';
import {enqueueDocumentExportPdfJob} from '../queue/document-export';
import * as documentService from '../services/document';
import {convertExportHtmlToDocx} from '../services/document-export-docx';
import {
  buildExportHtmlDocument,
  replaceExportPlaceholderNodes,
  replaceMermaidNodesWithImages
} from '../services/document-export-html';
import {serializeDocumentToMarkdown} from '../services/document-export-markdown';
import {getDocumentExportStream} from '../services/document-export-storage';
import {isValidUuid} from '../utils/uuid';

const exportDocumentSchema = z.object({
  format: z.enum(['markdown', 'word', 'pdf'])
});

/** RFC 5987：文件名允许中文（如文档标题）时必须用 `filename*=UTF-8''...` 形式，
 * 同时保留一个 ASCII 降级值兼容不认识扩展语法的旧客户端。 */
function contentDisposition(filename: string): string {
  const asciiFallback = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

/**
 * 导出文档（见 tasks.md 5.1、spec.md「Markdown/Word 导出同步返回文件」「PDF 导出走异步
 * 任务与轮询」）：Markdown/Word 在同一次请求内完成转换直接返回文件；PDF 创建
 * `DocumentExport` 记录、入队 `document-export-pdf`，立即返回任务标识（202 Accepted）。
 * 权限（`requireAuth` + `requireWikiRole('VIEWER')`）由路由层挂载（见 routes/document-export.ts）。
 */
export async function exportDocumentHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const documentId = req.params['documentId'];
  if (!documentId || !isValidUuid(documentId)) {
    res.status(404).json({error: 'not_found'});
    return;
  }

  const userId = req.user?.id;
  if (userId === undefined) {
    res.status(401).json({error: 'unauthorized'});
    return;
  }

  const parsed = exportDocumentSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({error: 'invalid_input', details: parsed.error.flatten()});
    return;
  }

  try {
    // 导出内容以物化只读内容为准（跟 GET 文档接口同一份 content，不读 Yjs 实时状态）
    const doc = await documentService.getDocument(req.params['wikiId'] as string, documentId);

    if (parsed.data.format === 'markdown') {
      // 标题是独立字段、不在正文 JSON 里，作为一级标题拼在最前（与 Word/PDF 的
      // buildExportHtmlDocument 行为一致）
      const markdown = `# ${doc.title}\n\n${serializeDocumentToMarkdown(doc.content)}`;
      res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
      res.setHeader('Content-Disposition', contentDisposition(`${doc.title}.md`));
      res.send(Buffer.from(markdown, 'utf-8'));
      return;
    }

    if (parsed.data.format === 'word') {
      const content = await replaceMermaidNodesWithImages(
        replaceExportPlaceholderNodes(doc.content)
      );
      const html = buildExportHtmlDocument(doc.title, content);
      const docx = await convertExportHtmlToDocx(html);
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      );
      res.setHeader('Content-Disposition', contentDisposition(`${doc.title}.docx`));
      res.setHeader('Content-Length', String(docx.length));
      res.send(docx);
      return;
    }

    // PDF：创建任务记录 + 入队，不阻塞请求线程（见 design.md 决策 7）
    const record = await createDocumentExport({documentId, requestedBy: userId});
    await enqueueDocumentExportPdfJob({exportId: record.id, documentId});
    res.status(202).json({exportId: record.id, status: record.status});
  } catch (err) {
    next(err);
  }
}

/** 导出任务与路径参数的 documentId 不匹配（或不存在）时统一 404，不泄露其他文档的
 * 任务信息 */
async function findExportForDocument(
  wikiId: string,
  documentId: string,
  exportId: string
): Promise<Awaited<ReturnType<typeof findDocumentExportById>>> {
  if (!isValidUuid(documentId) || !isValidUuid(exportId)) return null;
  const record = await findDocumentExportById(exportId);
  if (!record || record.documentId !== documentId) return null;
  // 顺带校验文档仍归属当前 wiki（文档被删除后任务记录仍在保留期内，此时按 404 处理）
  try {
    await documentService.getDocument(wikiId, documentId);
  } catch {
    return null;
  }
  return record;
}

/**
 * 查询导出任务状态（见 tasks.md 5.2、spec.md「轮询任务状态直至就绪」）：`READY` 时附带
 * 下载地址（相对路径，指向本组挂载的 download 路由）；`FAILED` 时附带可读的失败原因。
 */
export async function getDocumentExportStatusHandler(req: Request, res: Response): Promise<void> {
  // 路由模式保证了三个参数都存在；`?? ''` 只是满足 noUncheckedIndexedAccess 的收窄，
  // 缺失时 isValidUuid 返回 false，走统一的 404 分支
  const wikiId = req.params['wikiId'] ?? '';
  const documentId = req.params['documentId'] ?? '';
  const exportId = req.params['exportId'] ?? '';
  const record = await findExportForDocument(wikiId, documentId, exportId);
  if (!record) {
    res.status(404).json({error: 'not_found'});
    return;
  }

  res.json({
    export: {
      id: record.id,
      format: record.format,
      status: record.status,
      ...(record.errorMessage !== null ? {errorMessage: record.errorMessage} : {}),
      ...(record.status === 'READY'
        ? {
            downloadUrl: `/wikis/${wikiId}/documents/${documentId}/exports/${exportId}/download`
          }
        : {})
    }
  });
}

/**
 * 下载已就绪的导出产物（见 tasks.md 5.3）：状态不是 `READY` 一律 409（任务存在但产物
 * 未生成好），从对象存储流式返回、不整体读进内存。
 */
export async function downloadDocumentExportHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const wikiId = req.params['wikiId'] ?? '';
  const documentId = req.params['documentId'] ?? '';
  const exportId = req.params['exportId'] ?? '';
  try {
    const record = await findExportForDocument(wikiId, documentId, exportId);
    if (!record) {
      res.status(404).json({error: 'not_found'});
      return;
    }
    if (record.status !== 'READY' || !record.objectKey) {
      res.status(409).json({error: 'not_ready'});
      return;
    }

    const doc = await documentService.getDocument(wikiId, documentId);
    const stream = await getDocumentExportStream(record.objectKey);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', contentDisposition(`${doc.title}.pdf`));
    stream.on('error', err => {
      logger.error({err, exportId}, 'document export download stream failed');
      res.destroy(err);
    });
    stream.pipe(res);
  } catch (err) {
    next(err);
  }
}
