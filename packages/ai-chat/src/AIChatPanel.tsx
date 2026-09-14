import {type Citation, streamChat, synthesizeTts, transcribeAudio} from '@luhanxin/api-client';
import type {EditorBridge} from '@luhanxin/tiptap-editor';
import {Button} from '@luhanxin/ui';
import {Loader2, Mic, Paperclip, Send, Sparkles, Volume2, X} from 'lucide-react';
import type {ChangeEvent, ClipboardEvent} from 'react';
import {useRef, useState} from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export type AiChatMode = 'write' | 'ask';

export interface AIChatPanelProps {
  /** 固定模式：write（编辑器旁写作，写回编辑器）| ask（全局知识库问答，只读引用） */
  mode: AiChatMode;
  /** write 模式需要：AI 编辑器桥（写回内容用），ask 模式可不传 */
  editorBridge?: EditorBridge | null;
  /** write 模式需要：目标文档 id */
  documentId?: string;
  documentTitle?: string;
  /** 关闭回调（抽屉场景用），传入时头部显示关闭按钮 */
  onClose?: () => void;
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  citations?: Citation[];
  error?: boolean;
}

const SESSION_KEY_PREFIX = 'ai-chat:session-id';
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** 会话 id 持久化到 localStorage（决策 13：客户端只持 sessionId，服务端 Redis 存历史） */
function getOrCreateSessionId(mode: AiChatMode): string {
  const key = `${SESSION_KEY_PREFIX}:${mode}`;
  const existing = localStorage.getItem(key);
  if (existing) return existing;
  const id = crypto.randomUUID();
  localStorage.setItem(key, id);
  return id;
}

/** Markdown 渲染：react-markdown + 自定义 Tailwind 样式（项目未引入 @tailwindcss/typography） */
function Markdown({children}: {children: string}) {
  return (
    <div className="space-y-2 text-sm leading-relaxed [&_a]:text-primary [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-xs [&_h1]:text-lg [&_h1]:font-bold [&_h2]:text-base [&_h2]:font-bold [&_h3]:text-sm [&_h3]:font-semibold [&_h4]:text-sm [&_h4]:font-semibold [&_hr]:my-3 [&_li]:ml-4 [&_ol]:list-decimal [&_p]:my-1 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-muted [&_pre]:p-3 [&_pre]:text-xs [&_strong]:font-semibold [&_table]:my-2 [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:px-2 [&_th]:py-1 [&_ul]:list-disc">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  );
}

export function AIChatPanel({
  mode,
  editorBridge = null,
  documentId,
  documentTitle = '',
  onClose
}: AIChatPanelProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [recording, setRecording] = useState(false);
  const [sessionId] = useState(() => getOrCreateSessionId(mode));
  const abortRef = useRef<AbortController | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const recognitionRef = useRef<{stop?: () => void} | null>(null);

  function patchMessage(id: string, patch: Partial<Message>): void {
    setMessages(prev => prev.map(m => (m.id === id ? {...m, ...patch} : m)));
  }

  async function handleSend(): Promise<void> {
    const instruction = input.trim();
    if (!instruction || streaming) return;
    setInput('');
    setStreaming(true);

    const pendingImages = images;
    setImages([]);

    const userMsg: Message = {id: crypto.randomUUID(), role: 'user', content: instruction};
    const assistantMsg: Message = {id: crypto.randomUUID(), role: 'assistant', content: ''};
    setMessages(prev => [...prev, userMsg, assistantMsg]);

    const ctx = editorBridge?.getContext();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const stream = await streamChat(
        {
          mode,
          instruction,
          sessionId,
          documentId: mode === 'write' ? documentId : undefined,
          title: documentTitle || undefined,
          selectedText: ctx?.selectedText ?? undefined,
          contextSlice: ctx?.contextSlice ?? undefined,
          images: pendingImages.length > 0 ? pendingImages : undefined
        },
        controller.signal
      );

      let text = '';
      let citations: Citation[] | undefined;
      const reader = stream.getReader();

      while (true) {
        const {done, value} = await reader.read();
        if (done) break;
        if (value.type === 'text') {
          text += value.text;
          patchMessage(assistantMsg.id, {content: text, citations});
        } else if (value.type === 'citations') {
          citations = value.citations;
          patchMessage(assistantMsg.id, {citations});
        } else if (value.type === 'error') {
          text += `\n[错误] ${value.error}`;
          patchMessage(assistantMsg.id, {content: text, error: true});
        }
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        patchMessage(assistantMsg.id, {
          content: `[请求失败] ${err instanceof Error ? err.message : String(err)}`,
          error: true
        });
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }

  function handleApply(content: string): void {
    editorBridge?.apply(content);
  }

  async function handleSpeak(content: string): Promise<void> {
    // 本地优先：浏览器 speechSynthesis（无需后端 key，本地 Ollama 场景可用）
    if ('speechSynthesis' in window) {
      speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(content);
      utterance.lang = 'zh-CN';
      utterance.rate = 1.0;
      utterance.pitch = 1.0;
      // 优先选一个中文 voice（比系统默认音色更自然，如 macOS 的 Ting-Ting）
      const zhVoice = speechSynthesis
        .getVoices()
        .find(v => v.lang.toLowerCase().replace('_', '-').startsWith('zh'));
      if (zhVoice) utterance.voice = zhVoice;
      speechSynthesis.speak(utterance);
      return;
    }
    // 回退：后端 TTS（云端 provider 场景）
    try {
      const blob = await synthesizeTts(content);
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.onended = () => URL.revokeObjectURL(url);
      await audio.play();
    } catch {
      // TTS 失败静默
    }
  }

  function handleImageFile(file: File): void {
    if (!file.type.startsWith('image/')) return;
    if (file.size > MAX_IMAGE_BYTES) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.slice(result.indexOf(',') + 1);
      setImages(prev => [...prev, base64]);
    };
    reader.readAsDataURL(file);
  }

  function handlePaste(event: ClipboardEvent<HTMLDivElement>): void {
    const files = Array.from(event.clipboardData.items)
      .filter(item => item.type.startsWith('image/'))
      .map(item => item.getAsFile())
      .filter((file): file is File => file !== null);
    if (files.length === 0) return;
    event.preventDefault();
    files.forEach(handleImageFile);
  }

  function handleImageInput(event: ChangeEvent<HTMLInputElement>): void {
    const files = Array.from(event.target.files ?? []);
    files.forEach(handleImageFile);
    event.target.value = '';
  }

  async function toggleRecording(): Promise<void> {
    if (recording) {
      recognitionRef.current?.stop?.();
      recorderRef.current?.stop();
      return;
    }

    // 本地优先：浏览器 SpeechRecognition（Web Speech API，无需后端 key，本地 Ollama 场景可用）
    const w = window as unknown as {
      SpeechRecognition?: new () => Record<string, unknown>;
      webkitSpeechRecognition?: new () => Record<string, unknown>;
    };
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (Ctor) {
      const recognition = new Ctor() as {
        lang: string;
        interimResults: boolean;
        onresult: ((event: {results: Array<Array<{transcript: string}>>}) => void) | null;
        onend: (() => void) | null;
        onerror: (() => void) | null;
        start: () => void;
        stop: () => void;
      };
      recognition.lang = 'zh-CN';
      recognition.interimResults = false;
      recognition.onresult = event => {
        const text = event.results[0]?.[0]?.transcript ?? '';
        if (text) setInput(prev => (prev ? `${prev}\n` : '') + text);
      };
      recognition.onend = () => setRecording(false);
      recognition.onerror = () => setRecording(false);
      recognition.start();
      recognitionRef.current = recognition;
      setRecording(true);
      return;
    }

    // 回退：MediaRecorder 录音 + 后端 transcribeAudio（云端 provider 场景）
    try {
      const stream = await navigator.mediaDevices.getUserMedia({audio: true});
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = ev => {
        if (ev.data.size > 0) chunksRef.current.push(ev.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach(track => {
          track.stop();
        });
        setRecording(false);
        void (async () => {
          try {
            const blob = new Blob(chunksRef.current, {type: recorder.mimeType || 'audio/webm'});
            const text = await transcribeAudio(blob, 'audio.webm');
            setInput(prev => (prev ? `${prev}\n` : '') + text);
          } catch {
            // 转写失败静默
          }
        })();
      };
      recorder.start();
      recorderRef.current = recorder;
      setRecording(true);
    } catch {
      // 麦克风权限被拒绝
    }
  }

  const title = mode === 'write' ? 'AI 写作' : 'AI 问答';
  const emptyHint =
    mode === 'write'
      ? '描述你想写或改的内容，生成后可插入编辑器'
      : '就你拥有权限的全部文档提问，答案会引用来源';

  return (
    <div className="flex h-full min-h-0 flex-col bg-card">
      {/* 头部 */}
      <div className="flex items-center gap-2 border-b px-4 py-3">
        <div className="flex size-6 items-center justify-center rounded-md bg-primary/10 text-primary">
          <Sparkles className="size-3.5" />
        </div>
        <div className="flex flex-1 flex-col">
          <span className="text-sm font-semibold leading-tight">{title}</span>
          <span className="text-xs text-muted-foreground">
            {mode === 'write' ? '控制当前文档书写' : '知识库检索问答'}
          </span>
        </div>
        {onClose ? (
          <Button type="button" variant="ghost" size="icon-sm" onClick={onClose} aria-label="关闭">
            <X className="size-4" />
          </Button>
        ) : null}
      </div>

      {/* 消息列表 */}
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4" onPaste={handlePaste}>
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <div className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <Sparkles className="size-5" />
            </div>
            <p className="max-w-[220px] text-xs text-muted-foreground">{emptyHint}</p>
          </div>
        ) : null}

        {messages.map(msg =>
          msg.role === 'user' ? (
            <div key={msg.id} className="flex justify-end">
              <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-3.5 py-2 text-sm text-primary-foreground shadow-sm">
                <div className="whitespace-pre-wrap break-words">{msg.content}</div>
              </div>
            </div>
          ) : (
            <div key={msg.id} className="flex items-start gap-2">
              <div className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Sparkles className="size-3.5" />
              </div>
              <div className="max-w-[85%]">
                <div className="rounded-2xl rounded-tl-sm border bg-background px-3.5 py-2 text-sm shadow-sm">
                  {msg.content ? (
                    <Markdown>{msg.content}</Markdown>
                  ) : streaming ? (
                    <span className="inline-block h-3 w-1 animate-pulse bg-primary align-middle" />
                  ) : null}
                </div>
                {msg.citations && msg.citations.length > 0 ? (
                  <div className="mt-2 space-y-1">
                    <span className="text-[11px] text-muted-foreground">引用来源</span>
                    {msg.citations.map((c, i) => (
                      <details key={`${c.documentId}-${c.snippet.slice(0, 24)}`} className="group">
                        <summary className="cursor-pointer list-none rounded-md bg-muted px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-muted/70">
                          文档 {i + 1}
                        </summary>
                        <p className="mt-1 rounded-md bg-muted/50 px-2 py-1.5 text-xs leading-relaxed text-muted-foreground">
                          {c.snippet}…
                        </p>
                      </details>
                    ))}
                  </div>
                ) : null}
                {msg.content && !streaming ? (
                  <div className="mt-1.5 flex items-center gap-1">
                    {mode === 'write' && editorBridge ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="xs"
                        onClick={() => handleApply(msg.content)}
                      >
                        插入
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      onClick={() => void handleSpeak(msg.content)}
                    >
                      <Volume2 className="size-3" />
                      朗读
                    </Button>
                  </div>
                ) : null}
              </div>
            </div>
          )
        )}
      </div>

      {/* 输入区（内嵌卡片） */}
      <div className="border-t p-3">
        {images.length > 0 ? (
          <div className="mb-2 flex flex-wrap gap-2">
            {images.map((img, index) => (
              <div
                key={img.slice(0, 24)}
                className="relative size-12 overflow-hidden rounded-lg border"
              >
                <img
                  src={`data:image/png;base64,${img}`}
                  alt="附件"
                  className="size-full object-cover"
                />
                <button
                  type="button"
                  className="absolute right-0 top-0 rounded-bl-md bg-black/60 p-0.5 text-white"
                  onClick={() => setImages(prev => prev.filter((_, i) => i !== index))}
                >
                  <X className="size-3" />
                </button>
              </div>
            ))}
          </div>
        ) : null}

        <div className="rounded-xl border bg-background p-2 transition-shadow focus-within:ring-2 focus-within:ring-ring">
          <textarea
            className="min-h-[52px] w-full resize-none bg-transparent px-2 py-1.5 text-sm outline-none"
            placeholder={mode === 'write' ? '描述你想写/改的内容…' : '就你的知识库提问…'}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void handleSend();
              }
            }}
          />
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1">
              <Button
                type="button"
                size="icon-sm"
                variant={recording ? 'destructive' : 'ghost'}
                onClick={() => void toggleRecording()}
              >
                <Mic className={recording ? 'size-4 animate-pulse' : 'size-4'} />
              </Button>
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                onClick={() => fileInputRef.current?.click()}
              >
                <Paperclip className="size-4" />
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={handleImageInput}
              />
            </div>
            <Button
              type="button"
              size="sm"
              disabled={streaming || !input.trim()}
              onClick={() => void handleSend()}
            >
              {streaming ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Send className="size-4" />
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
