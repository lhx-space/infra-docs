import {chromium} from 'playwright';
import {logger} from '../logger';
import {findDocumentById} from '../models/document';
import {
  markDocumentExportFailed,
  markDocumentExportProcessing,
  markDocumentExportReady
} from '../models/document-export';
import type {DocumentExportPdfJobData} from '../queue/document-export';
import {
  buildExportHtmlDocument,
  replaceExportPlaceholderNodes,
  replaceMermaidNodesWithImages
} from '../services/document-export-html';
import {uploadDocumentExportPdf} from '../services/document-export-storage';

/**
 * 消费一条 PDF 导出任务（见 tasks.md 4.3/4.5，成败落库与写法对齐
 * jobs/process-video-transcode.ts）：
 *
 * 1. 标记 `PROCESSING`；
 * 2. 读文档当前的物化内容（`findDocumentById`，跟 REST `GET` 文档接口同一份只读视图，
 *    不读 Yjs 实时状态，见 spec.md「导出内容以物化内容为准」）；
 * 3. 占位节点替换（视频/无效图片 → 文字说明）+ Mermaid 光栅化（→ data URI 图片，
 *    services/document-export-html.ts 统一封装）+ 生成自包含 HTML；
 * 4. Playwright `setContent` + `page.pdf()` 生成分页 PDF（`networkidle` 等正文里的
 *    远程图片加载完成，`printBackground` 保留代码块/表格背景色）；
 * 5. 产物上传 `document-exports` 前缀并标记 `READY`。
 *
 * 任意步骤失败：标记 `FAILED` + 可读 `errorMessage`（前端轮询可见，见 spec.md
 * 「生成失败的状态反馈」），再向上抛出让 BullMQ 也把 job 标记为 failed（保留运维可见性，
 * 跟视频转码 job 的取向一致）。
 */
export async function processDocumentExportPdfJob(data: DocumentExportPdfJobData): Promise<void> {
  const {exportId, documentId} = data;

  try {
    await markDocumentExportProcessing(exportId);

    const doc = await findDocumentById(documentId);
    if (!doc) {
      // 文档在任务排队期间被删除：确定性的失败，重试没有意义，落 FAILED 后正常结束
      await markDocumentExportFailed(exportId, '文档不存在或已被删除');
      logger.info({exportId, documentId}, 'document export aborted: document missing');
      return;
    }

    const content = await replaceMermaidNodesWithImages(replaceExportPlaceholderNodes(doc.content));
    const html = buildExportHtmlDocument(doc.title, content);

    const browser = await chromium.launch();
    let pdf: Buffer;
    try {
      const page = await browser.newPage();
      // 大文档多图时 networkidle 需要更长等待窗口，默认 30s 偏紧
      await page.setContent(html, {waitUntil: 'networkidle', timeout: 60_000});
      pdf = Buffer.from(
        await page.pdf({
          format: 'A4',
          printBackground: true,
          margin: {top: '20mm', bottom: '20mm', left: '16mm', right: '16mm'}
        })
      );
    } finally {
      await browser.close();
    }

    const {objectKey} = await uploadDocumentExportPdf(exportId, pdf);
    await markDocumentExportReady(exportId, objectKey);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({err, exportId, documentId}, 'document export pdf failed');
    try {
      await markDocumentExportFailed(exportId, message);
    } catch (markErr) {
      // 记录本身也可能被清理 job 删掉（极端竟态），标记失败失败不该掩盖原始错误
      logger.error({markErr, exportId}, 'mark document export FAILED failed');
    }
    throw err;
  }
}
