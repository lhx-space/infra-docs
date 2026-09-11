import {saveBlobFile} from '@luhanxin/api-client';
import {getDesktopBridge} from '@luhanxin/desktop-bridge';

/**
 * 保存导出文件：Electron 里走原生「另存为」对话框（window.bridge.saveFile），
 * 普通浏览器里回退到 Blob 下载（api-client 的 saveBlobFile）。二进制内容统一转成
 * Uint8Array 走 IPC，避免把 Blob 当 JSON 序列化。
 */
export async function saveExportedFile(blob: Blob, filename: string): Promise<void> {
  const bridge = getDesktopBridge();
  if (bridge) {
    const content = new Uint8Array(await blob.arrayBuffer());
    await bridge.saveFile({defaultPath: filename, content});
    return;
  }
  saveBlobFile(blob, filename);
}
