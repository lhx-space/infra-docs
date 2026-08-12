import dns from 'node:dns/promises';
import net from 'node:net';
import {logger} from '../logger';

/** 抓取超时（见 link-preview spec.md「抓取超时与响应体限制」） */
const TIMEOUT_MS = 5000;
/** 响应体大小上限：链接预览只需要 `<head>` 里的少量 meta 信息，2MB 足够覆盖绝大多数页面 */
const MAX_BODY_BYTES = 2 * 1024 * 1024;
/** 跟随重定向的最大跳数，每一跳都要重新做 SSRF 校验，防止用重定向绕过第一跳的地址检查 */
const MAX_REDIRECTS = 3;

export interface LinkPreviewResult {
  title?: string;
  description?: string;
  image?: string;
  favicon?: string;
}

/**
 * 校验一个 IP 是否属于私有网段/回环/链路本地等内部地址（见 spec.md「拒绝对内网地址的抓取
 * 请求（SSRF 防护）」）。覆盖 IPv4 的 10/8、172.16/12、192.168/16、127/8（回环）、
 * 169.254/16（链路本地，含云平台常见的元数据服务地址 169.254.169.254）、0/8；
 * 以及 IPv6 的 ::1（回环）、fe80::/10（链路本地）、fc00::/7（唯一本地地址）。
 * 未识别的地址格式统一按"拒绝"处理，而不是放行——安全校验宁可误杀，不能漏判。
 */
function isPrivateOrReservedIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const parts = ip.split('.').map(Number);
    const a = parts[0] ?? 0;
    const b = parts[1] ?? 0;
    if (a === 10) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 0) return true;
    return false;
  }

  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    if (lower === '::1') return true;
    if (lower.startsWith('fe80:') || lower.startsWith('fc00:') || lower.startsWith('fd00:')) {
      return true;
    }
    if (lower.startsWith('::ffff:')) {
      const mapped = lower.slice('::ffff:'.length);
      if (net.isIPv4(mapped)) return isPrivateOrReservedIp(mapped);
    }
    return false;
  }

  return true;
}

async function assertPublicHostname(hostname: string): Promise<void> {
  const addresses = await dns.lookup(hostname, {all: true, verbatim: true});
  if (addresses.length === 0) throw new Error('resolve_failed');
  for (const {address} of addresses) {
    if (isPrivateOrReservedIp(address)) throw new Error('private_address_blocked');
  }
}

async function readBodyWithLimit(response: Response, maxBytes: number): Promise<string | null> {
  const reader = response.body?.getReader();
  if (!reader) return null;

  let received = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const {done, value} = await reader.read();
    if (done) break;
    if (value) {
      received += value.byteLength;
      if (received > maxBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  }
  return Buffer.concat(chunks.map(chunk => Buffer.from(chunk))).toString('utf-8');
}

function extractMeta(html: string, property: string): string | undefined {
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const forward = new RegExp(
    `<meta[^>]+(?:property|name)=["']${escaped}["'][^>]*content=["']([^"']*)["']`,
    'i'
  );
  const backward = new RegExp(
    `<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${escaped}["']`,
    'i'
  );
  return html.match(forward)?.[1] ?? html.match(backward)?.[1];
}

function extractTitle(html: string): string | undefined {
  return html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim();
}

function safeResolveUrl(candidate: string, base: URL): string | undefined {
  try {
    return new URL(candidate, base).toString();
  } catch {
    return undefined;
  }
}

function extractFavicon(html: string, base: URL): string | undefined {
  const match = html.match(/<link[^>]+rel=["'](?:shortcut )?icon["'][^>]+href=["']([^"']+)["']/i);
  const href = match?.[1];
  if (href) {
    const resolved = safeResolveUrl(href, base);
    if (resolved) return resolved;
  }
  return safeResolveUrl('/favicon.ico', base);
}

function parseOpenGraph(html: string, base: URL): LinkPreviewResult {
  const title = extractMeta(html, 'og:title') ?? extractTitle(html);
  const description = extractMeta(html, 'og:description') ?? extractMeta(html, 'description');
  const imageRaw = extractMeta(html, 'og:image');
  return {
    title,
    description,
    image: imageRaw ? safeResolveUrl(imageRaw, base) : undefined,
    favicon: extractFavicon(html, base)
  };
}

/**
 * 抓取目标 URL 的 OpenGraph 元信息（见 link-preview spec.md）。返回 `null` 表示"抓取失败"
 * 的任意原因（SSRF 校验拒绝、超时、网络错误、响应体过大、无法解析），调用方（handler）统一
 * 把 `null` 翻译成"不可用"结果，不区分具体失败原因地暴露给前端——前端只需要知道"降级成
 * 纯文本链接"，不需要知道背后是被 SSRF 拦了还是纯粹网络超时。
 */
export async function fetchLinkPreview(rawUrl: string): Promise<LinkPreviewResult | null> {
  let currentUrl = rawUrl;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let parsed: URL;
    try {
      parsed = new URL(currentUrl);
    } catch {
      return null;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;

    try {
      await assertPublicHostname(parsed.hostname);
    } catch (err) {
      logger.warn({err, url: parsed.toString()}, 'link preview blocked');
      return null;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(parsed.toString(), {
        signal: controller.signal,
        redirect: 'manual',
        headers: {'user-agent': 'yjs-docs-link-preview/1.0'}
      });
    } catch (err) {
      logger.warn({err, url: parsed.toString()}, 'link preview fetch failed');
      return null;
    } finally {
      clearTimeout(timer);
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      const nextUrl = location ? safeResolveUrl(location, parsed) : undefined;
      if (!nextUrl) return null;
      currentUrl = nextUrl;
      continue;
    }

    if (!response.ok) return null;

    const html = await readBodyWithLimit(response, MAX_BODY_BYTES);
    if (html === null) return null;

    return parseOpenGraph(html, parsed);
  }

  return null;
}
