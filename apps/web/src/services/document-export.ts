import {ApiError, http} from '@/network';
import {useAuthStore} from '@/store/auth';

/**
 * 文档导出的前端薄封装（见 document-export spec.md）：Markdown/Word 走同步接口直接拿
 * 文件流；PDF 走"提交任务 → 轮询状态 → 就绪后下载"的异步模式（对齐后端
 * routes/document-export.ts 的三个接口）。
 */

export type SyncExportFormat = 'markdown' | 'word';

export type DocumentExportStatus = 'PENDING' | 'PROCESSING' | 'READY' | 'FAILED';

export interface CreatePdfExportResult {
  exportId: string;
  status: DocumentExportStatus;
}

export interface DocumentExportStatusResult {
  export: {
    id: string;
    format: string;
    status: DocumentExportStatus;
    errorMessage?: string;
    /** status = READY 时才有，相对 API 根路径的下载地址 */
    downloadUrl?: string;
  };
}

/** 提交 PDF 导出任务，立即返回任务标识（后端 202） */
export function createPdfExport(
  wikiId: string,
  documentId: string
): Promise<CreatePdfExportResult> {
  return http.post<CreatePdfExportResult>(`/wikis/${wikiId}/documents/${documentId}/export`, {
    format: 'pdf'
  });
}

/** 轮询导出任务状态，READY 时响应附带下载地址 */
export function getDocumentExportStatus(
  wikiId: string,
  documentId: string,
  exportId: string
): Promise<DocumentExportStatusResult> {
  return http.get<DocumentExportStatusResult>(
    `/wikis/${wikiId}/documents/${documentId}/exports/${exportId}`
  );
}

const BASE_URL = import.meta.env.VITE_API_BASE_URL;

/**
 * 带认证的二进制文件下载：`network/client.ts` 的 `http` 封装只面向 JSON 响应，文件流
 * （Blob）需要单独走 fetch——认证头/401 之外的错误翻译逻辑跟它保持同一套（ApiError +
 * 后端 `{error}` 字段），不做静默刷新重试（导出是低频操作，失败让用户直接看到）。
 */
async function fetchExportFile(
  path: string,
  method: 'GET' | 'POST',
  body?: unknown
): Promise<Blob> {
  const accessToken = useAuthStore.getState().accessToken;
  const headers: Record<string, string> = {};
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    credentials: 'include',
    body: body === undefined ? undefined : JSON.stringify(body)
  });

  if (!response.ok) {
    let message = response.statusText || 'request_failed';
    try {
      const payload = (await response.json()) as {error?: unknown} | undefined;
      if (payload && typeof payload.error === 'string') message = payload.error;
    } catch {
      // 非 JSON 错误体，保留 statusText
    }
    throw new ApiError(
      response.status,
      message,
      undefined,
      response.headers.get('x-trace-id') ?? undefined
    );
  }
  return response.blob();
}

/** Markdown/Word 同步导出：一次请求直接拿到文件内容 */
export function downloadSyncExport(
  wikiId: string,
  documentId: string,
  format: SyncExportFormat
): Promise<Blob> {
  return fetchExportFile(`/wikis/${wikiId}/documents/${documentId}/export`, 'POST', {format});
}

/** PDF 就绪后的产物下载（经鉴权路由中转，产物存储不公开） */
export function downloadPdfExport(
  wikiId: string,
  documentId: string,
  exportId: string
): Promise<Blob> {
  return fetchExportFile(
    `/wikis/${wikiId}/documents/${documentId}/exports/${exportId}/download`,
    'GET'
  );
}

/** 触发浏览器下载（Blob → object URL → 隐藏 <a> 点击） */
export function saveBlobFile(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  // 立即 revoke 在部分浏览器会截断尚未开始的下载，推迟到当前宏任务结束后回收
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
