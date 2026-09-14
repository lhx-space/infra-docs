import {getApiClientConfig} from '../config';

/**
 * AI 服务客户端（ai-server，见 openspec/changes/ai-assistant）：
 * - `streamChat`：SSE 流式聊天（`fetch` + `ReadableStream` + `TextDecoder`，不用
 *   EventSource——后者只支持 GET、带不了 Authorization 头、也不能 POST/abort）；
 * - `synthesizeTts`：TTS 语音合成，返回音频 Blob。
 */

export interface ChatRequest {
  mode: 'write' | 'ask';
  instruction: string;
  /** 会话 id（决策 13）：为空 = 单轮，非空由服务端读写 Redis 历史 */
  sessionId?: string;
  /** write 模式必填 */
  documentId?: string;
  title?: string;
  selectedText?: string;
  contextSlice?: string;
  /** 随消息附带的图片（base64，不含 `data:` 前缀），vision 理解（决策 17） */
  images?: string[];
}

export interface Citation {
  documentId: string;
  snippet: string;
}

export type ChatStreamEvent =
  | {type: 'text'; text: string}
  | {type: 'citations'; citations: Citation[]}
  | {type: 'error'; error: string}
  | {type: 'done'};

function aiBaseUrl(): string {
  const cfg = getApiClientConfig();
  return cfg.aiBaseUrl ?? cfg.baseUrl;
}

/** 流式聊天：返回一个 SSE 事件流（含 text/citations/error/done） */
export async function streamChat(
  request: ChatRequest,
  signal?: AbortSignal
): Promise<ReadableStream<ChatStreamEvent>> {
  const cfg = getApiClientConfig();
  const token = cfg.getAccessToken();

  const response = await fetch(`${aiBaseUrl()}/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? {Authorization: `Bearer ${token}`} : {})
    },
    body: JSON.stringify(request),
    signal
  });

  if (!response.ok || !response.body) {
    throw new Error(`AI 请求失败：HTTP ${response.status}`);
  }

  return parseSseStream(response.body);
}

/** TTS：把文本合成为音频 Blob */
export async function synthesizeTts(
  text: string,
  voice?: string,
  signal?: AbortSignal
): Promise<Blob> {
  const cfg = getApiClientConfig();
  const token = cfg.getAccessToken();

  const response = await fetch(`${aiBaseUrl()}/tts`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? {Authorization: `Bearer ${token}`} : {})
    },
    body: JSON.stringify({text, voice}),
    signal
  });

  if (!response.ok) {
    throw new Error(`TTS 失败：HTTP ${response.status}`);
  }
  return response.blob();
}

/** STT：把音频 Blob 转写为文字（决策 16） */
export async function transcribeAudio(
  audio: Blob,
  filename: string,
  signal?: AbortSignal
): Promise<string> {
  const cfg = getApiClientConfig();
  const token = cfg.getAccessToken();

  const response = await fetch(
    `${aiBaseUrl()}/transcribe?filename=${encodeURIComponent(filename)}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': audio.type || 'audio/webm',
        ...(token ? {Authorization: `Bearer ${token}`} : {})
      },
      body: audio,
      signal
    }
  );

  if (!response.ok) {
    throw new Error(`语音转写失败：HTTP ${response.status}`);
  }
  const data = (await response.json()) as {text: string};
  return data.text;
}

/** 手动解析 SSE 帧流（`data:`/`event:` 行 + 空行分隔）成事件流 */
function parseSseStream(body: ReadableStream<Uint8Array>): ReadableStream<ChatStreamEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  return new ReadableStream<ChatStreamEvent>({
    async pull(controller) {
      const {done, value} = await reader.read();
      if (done) {
        // 流结束：把剩余 buffer 里可能的最后一个事件也解析掉
        const event = parseEvent(buffer);
        if (event) controller.enqueue(event);
        controller.close();
        return;
      }

      buffer += decoder.decode(value, {stream: true});

      let sep = buffer.indexOf('\n\n');
      while (sep >= 0) {
        const raw = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        const event = parseEvent(raw);
        if (event) controller.enqueue(event);
        sep = buffer.indexOf('\n\n');
      }
    }
  });
}

function parseEvent(raw: string): ChatStreamEvent | null {
  let eventName = '';
  const dataLines: string[] = [];

  for (const line of raw.split('\n')) {
    if (line.startsWith('event:')) {
      eventName = line.slice('event:'.length).trim();
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice('data:'.length).trim());
    }
  }

  // axum 的 Event 会把含 `\n` 的 data 拆成多行 `data:`，这里用换行重新拼接还原
  const data = dataLines.join('\n');

  if (!data && eventName !== 'done') return null;

  if (eventName === 'citations') {
    try {
      const parsed = JSON.parse(data) as {
        citations?: Array<{document_id: string; snippet: string}>;
      };
      return {
        type: 'citations',
        citations: (parsed.citations ?? []).map(c => ({
          documentId: c.document_id,
          snippet: c.snippet
        }))
      };
    } catch {
      return null;
    }
  }
  if (eventName === 'error') return {type: 'error', error: data};
  if (eventName === 'done' || data === '[DONE]') return {type: 'done'};

  return {type: 'text', text: data};
}
