import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {chromium} from 'playwright';

/**
 * Mermaid 图表光栅化为 PNG（见 design.md 决策 5、tasks.md 4.5）：Word/PDF 都无法嵌入
 * 交互式图表，统一用无头浏览器加载一个只引入 `mermaid` 包（跟 `packages/tiptap-editor`
 * 前端渲染用的是同一个 npm 依赖、同一份默认主题配置，见该包 `MermaidView.tsx`）的最小
 * 页面，逐个渲染并截图。
 *
 * **相对 design.md 措辞的一处务实简化**：design.md 决策 5 原话是"用跟 PDF 导出同一个
 * Playwright 无头浏览器实例"，字面上暗示 Word（同步请求）与 PDF（异步任务）应该共享同一个
 * 存活的浏览器进程。但 Word 是同步返回、PDF 是异步队列消费，两条路径的生命周期完全不重叠，
 * 跨请求常驻一个 Playwright 浏览器进程需要额外的生命周期管理（何时启动/何时关闭/并发请求
 * 互斥），价值与复杂度不成比例（呼应 design.md Non-Goals 的整体取向："先把链路跑通，不过早
 * 优化"）。这里改为"每次调用独立启动、用完立即关闭一个浏览器"——两条路径复用的是*同一套
 * 光栅化机制/同一份代码*，不是同一个存活进程；PDF 任务后续渲染整篇文档为 PDF 时（见
 * jobs/process-document-export-pdf.ts）会再单独启动一个浏览器，这是当前实现下唯一跟
 * design.md 字面描述有出入的地方，先如实记录在这里，不掩盖。
 */

/** mermaid 的 IIFE 自包含 bundle——`import.meta.resolve` 返回真实的 `file://` URL
 * （Node 20.6+ 稳定 API，本仓库 engines 要求 Node >=22）。**不能用**包根入口指向的
 * `mermaid.core.mjs`：那是给打包器/Node 用的 ESM 文件，内部还有 `ts-dedent` 一类裸
 * 模块导入（bare specifier），浏览器无法解析；而且 `file://` 页面加载 `file://`
 * ES Module 还会被 Chromium 按 CORS 拦截（file 源互为 opaque origin）。改成
 * `mermaid.min.js` 这个把全部依赖打进去的单文件 IIFE bundle，用 classic
 * `<script src>` 加载——classic script 不受上述两条限制，加载后暴露全局 `mermaid`，
 * 不需要额外起一个本地 HTTP server 只为这一个用途。 */
function resolveMermaidBundleUrl(): string {
  return import.meta.resolve('mermaid/dist/mermaid.min.js');
}

function buildRasterizerHtml(mermaidBundleUrl: string): string {
  return `<!doctype html>
<html>
<body style="margin:0;background:#ffffff;">
<div id="mermaid-container" style="display:inline-block;padding:16px;"></div>
<script src="${mermaidBundleUrl}"></script>
<script>
  // 跟前端 MermaidView.tsx 完全一致的初始化配置（见 design.md Risks「服务端光栅化的
  // Mermaid 图表视觉效果可能跟浏览器里实时渲染的略有差异」的缓解措施：复用同一份主题配置）。
  mermaid.initialize({startOnLoad: false, securityLevel: 'strict'});
  window.__mermaidRender = async (source) => {
    const {svg} = await mermaid.render('mermaid-export-diagram', source);
    document.getElementById('mermaid-container').innerHTML = svg;
  };
  window.__mermaidReady = true;
</script>
</body>
</html>`;
}

/**
 * 逐个把 Mermaid 源码渲染为 PNG 图片 buffer，顺序跟输入 `sources` 一致。单个图表渲染失败
 * （如用户写了语法错误的 Mermaid 源码）不中断其余图表的光栅化，也不中断整篇导出——失败的
 * 那一个位置返回 `null`，调用方据此决定降级展示（见 spec.md「转换遇到不支持导出的节点
 * 类型」同一个"不阻断整篇导出"的工程取向，只是这里是图表语法错误而不是节点类型未覆盖）。
 */
export async function rasterizeMermaidSources(sources: string[]): Promise<Array<Buffer | null>> {
  if (sources.length === 0) return [];

  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'mermaid-rasterizer-'));
  const htmlPath = path.join(tempDir, 'mermaid-render.html');
  await writeFile(htmlPath, buildRasterizerHtml(resolveMermaidBundleUrl()), 'utf-8');

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(`file://${htmlPath}`);
    await page.waitForFunction(
      () => (window as unknown as {__mermaidReady?: boolean}).__mermaidReady === true
    );

    const results: Array<Buffer | null> = [];
    for (const source of sources) {
      try {
        await page.evaluate(
          src =>
            (window as unknown as {__mermaidRender: (s: string) => Promise<void>}).__mermaidRender(
              src
            ),
          source
        );
        const buffer = await page.locator('#mermaid-container svg').screenshot();
        results.push(buffer);
      } catch {
        results.push(null);
      }
    }
    return results;
  } finally {
    await browser.close();
    await rm(tempDir, {recursive: true, force: true}).catch(() => {});
  }
}
