import {Extension} from '@tiptap/core';
import {EditorContent, ReactNodeViewRenderer, useEditor} from '@tiptap/react';
import type {KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent} from 'react';
import {useEffect, useMemo, useRef, useState} from 'react';
import {CodeBlockKeymap} from '../utils/code-block/code-block-keymap';
import {documentEditorExtensions} from '../utils/extensions';
import {setActiveImageUploadErrorHandler} from '../utils/image/image-upload-error-registry';
import {setActiveImageUploader} from '../utils/image/image-uploader-registry';
import {imageUploadPlugin} from '../utils/image/upload-image-plugin';
import {LinkPreviewPaste} from '../utils/link-preview/link-preview-extension';
import {
  type LinkPreviewResult,
  setActiveLinkPreviewFetcher
} from '../utils/link-preview/link-preview-registry';
import {
  getPendingUploadCount,
  subscribePendingUploadCount
} from '../utils/shared/pending-upload-registry';
import {SlashCommand} from '../utils/slash-command';
import {VideoPastePattern} from '../utils/video/video-paste-extension';
import {
  setActiveVideoStatusPoller,
  type VideoStatusResult
} from '../utils/video/video-status-registry';
import {setActiveVideoUploadErrorHandler} from '../utils/video/video-upload-error-registry';
import {
  setActiveVideoUploader,
  type VideoUploadResult
} from '../utils/video/video-uploader-registry';
import {CodeBlockView} from './CodeBlockView';
import {DocumentOutline} from './DocumentOutline';
import {FormattingBubbleMenu} from './FormattingBubbleMenu';
import {MermaidView} from './MermaidView';
import {VideoView} from './VideoView';
import {ZoomableMedia} from './ZoomableMedia';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export interface DocumentEditorProps {
  /**
   * 初始内容（ProseMirror JSON）。只在组件首次挂载时读取一次，切换到另一篇文档时，
   * 消费方必须用不同的 `key`（例如 `key={documentId}`）强制重新挂载，而不是期望这个
   * 组件在同一个实例上"热切换"内容——这跟大多数富文本编辑器组件的使用约定一致。
   */
  content: unknown;
  /** 当前用户角色是否允许编辑（`VIEWER` 传 `false`，见 spec.md「只读模式」） */
  editable: boolean;
  /** 离线时强制只读，即使 `editable` 为 true（见 spec.md「离线只读缓存」） */
  offline?: boolean;
  /** 标题：跟正文同属一个可滚动内容区，渲染在内容顶部（跟飞书一致——标题是文档内容的
   * 第一行，会跟着正文一起滚动，不是页面级固定的一条通栏）。标题本身仍然是独立字段，
   * 不会被写进 `content` JSON 里（见 design.md 决策 1），保存逻辑由消费方通过
   * `onTitleChange` 自己处理（跟 `onSave` 是同样的分工：组件只负责渲染和触发回调）。
   * 不传时不渲染标题区域。 */
  title?: string;
  onTitleChange?: (title: string) => void;
  titlePlaceholder?: string;
  /** 图片上传的具体实现由消费方注入，本组件不感知任何后端接口地址（见 design.md 决策） */
  uploadImage: (file: File) => Promise<string>;
  /** 图片上传失败（粘贴/拖拽/斜杠命令三个入口共用）时的提示回调；不传时只是静默失败——
   * 加载占位消失、不留下任何图片节点，这条核心行为不受影响，只是少一条提示
   * （见 document-editor spec.md「上传失败的处理」） */
  onImageUploadError?: (message: string) => void;
  /** 链接预览元信息抓取的具体实现由消费方注入；不传时选择"显示为预览卡片"会静默降级为
   * 纯文本链接（跟抓取失败走的是同一条降级路径，见 link-preview spec.md「抓取失败时自动降级」） */
  fetchLinkPreview?: (url: string) => Promise<LinkPreviewResult | null>;
  /** 视频上传的具体实现由消费方注入；不传时斜杠命令的"视频"候选项点选后不会有任何反应
   * （粘贴外部 `.m3u8` 地址不依赖这个 prop，始终可用，见 document-editor spec.md
   * 「视频插入来源」）。上传接口是异步转码，这里只需要返回 `assetId`，真正的转码结果
   * 通过 `pollVideoStatus` 轮询获得。 */
  uploadVideo?: (file: File) => Promise<VideoUploadResult>;
  /** 查询视频转码状态的具体实现由消费方注入；不传时上传来源的视频节点会永久停留在
   * "转码中"（见 document-editor spec.md「转码完成后自动更新」），不影响粘贴外部地址
   * 这条不需要查询状态的路径 */
  pollVideoStatus?: (assetId: string) => Promise<VideoStatusResult>;
  /** 视频上传失败时的提示回调，不传时静默失败（同 `onImageUploadError` 的分工） */
  onVideoUploadError?: (message: string) => void;
  /** 防抖结束后触发的保存回调；reject 会被捕获并展示为"保存失败" */
  onSave: (json: unknown) => Promise<void>;
  onSaveStatusChange?: (status: SaveStatus) => void;
  fullscreen?: boolean;
  onFullscreenChange?: (next: boolean) => void;
  className?: string;
  /** 自动保存防抖时长（毫秒），默认 800ms（见 spec.md「停止输入后自动保存」） */
  autosaveDelay?: number;
}

function cx(...classNames: Array<string | false | undefined | null>): string {
  return classNames.filter(Boolean).join(' ');
}

/** 用 ProseMirror Plugin 挂上传占位 decoration，不需要额外的 Schema 定义（见 utils/upload-image-plugin.ts） */
const ImageUploadDecorations = Extension.create({
  name: 'imageUploadDecorations',
  addProseMirrorPlugins() {
    return [imageUploadPlugin];
  }
});

/**
 * 开箱即用的块级文档编辑器组件（见 proposal.md「导出一个开箱即用的组件」）。整合了本轮
 * 全部编辑器能力：受支持的块类型、斜杠命令、悬浮工具栏、代码块交互、Mermaid 双态、大纲导航、
 * 全屏模式、图片上传（粘贴/拖拽/斜杠命令三个入口共用同一条上传+占位流程，不额外提供常驻的
 * 工具栏按钮——跟飞书一致，插入图片不需要占一个持续可见的 UI 位置）、自动保存与状态反馈。
 */
export function DocumentEditor({
  content,
  editable,
  offline = false,
  title,
  onTitleChange,
  titlePlaceholder = '未命名文档',
  uploadImage,
  onImageUploadError,
  fetchLinkPreview,
  uploadVideo,
  pollVideoStatus,
  onVideoUploadError,
  onSave,
  onSaveStatusChange,
  fullscreen = false,
  onFullscreenChange,
  className,
  autosaveDelay = 800
}: DocumentEditorProps) {
  const isEditable = editable && !offline;
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestContentRef = useRef<unknown>(content);

  const extensions = useMemo(
    () => [
      ...documentEditorExtensions.map(extension => {
        if (extension.name === 'codeBlock') {
          return extension.extend({addNodeView: () => ReactNodeViewRenderer(CodeBlockView)});
        }
        if (extension.name === 'mermaid') {
          return extension.extend({addNodeView: () => ReactNodeViewRenderer(MermaidView)});
        }
        if (extension.name === 'video') {
          return extension.extend({addNodeView: () => ReactNodeViewRenderer(VideoView)});
        }
        return extension;
      }),
      SlashCommand,
      ImageUploadDecorations,
      // 必须排在 LinkPreviewPaste 之后——Tiptap 的 ExtensionManager.plugins 在构建
      // ProseMirror 插件列表时会把 extensions 数组整体 `.reverse()`（见
      // @tiptap/core dist/index.js `get plugins()`），也就是数组里排得越靠后的扩展，
      // 实际生效的插件优先级越高。两者的 `handlePaste` 都会尝试处理"整段粘贴内容是一个
      // URL"，真机验证过：把 VideoPastePattern 放前面反而会被 LinkPreviewPaste 的
      // 通用 URL 匹配抢先命中、弹出"纯链接/预览卡片"选择框——必须让它排在后面，
      // `.m3u8` 地址才能被优先识别成视频（见 utils/video-paste-extension.ts 顶部注释）
      LinkPreviewPaste,
      VideoPastePattern,
      CodeBlockKeymap
    ],
    []
  );

  function updateSaveStatus(status: SaveStatus): void {
    setSaveStatus(status);
    onSaveStatusChange?.(status);
  }

  async function performSave(json: unknown): Promise<void> {
    updateSaveStatus('saving');
    try {
      await onSave(json);
      updateSaveStatus('saved');
    } catch {
      updateSaveStatus('error');
    }
  }

  function scheduleSave(json: unknown): void {
    latestContentRef.current = json;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => void performSave(json), autosaveDelay);
  }

  const editor = useEditor(
    {
      extensions,
      content: content as object,
      editable: isEditable,
      onUpdate: ({editor: instance}) => scheduleSave(instance.getJSON())
    },
    []
  );

  useEffect(() => {
    editor.setEditable(isEditable);
  }, [editor, isEditable]);

  useEffect(() => {
    setActiveImageUploader(isEditable ? uploadImage : null);
    return () => setActiveImageUploader(null);
  }, [isEditable, uploadImage]);

  useEffect(() => {
    setActiveImageUploadErrorHandler(isEditable ? (onImageUploadError ?? null) : null);
    return () => setActiveImageUploadErrorHandler(null);
  }, [isEditable, onImageUploadError]);

  useEffect(() => {
    setActiveLinkPreviewFetcher(isEditable ? (fetchLinkPreview ?? null) : null);
    return () => setActiveLinkPreviewFetcher(null);
  }, [isEditable, fetchLinkPreview]);

  useEffect(() => {
    setActiveVideoUploader(isEditable ? (uploadVideo ?? null) : null);
    return () => setActiveVideoUploader(null);
  }, [isEditable, uploadVideo]);

  useEffect(() => {
    setActiveVideoStatusPoller(pollVideoStatus ?? null);
    return () => setActiveVideoStatusPoller(null);
    // 不受 isEditable 限制：VIEWER 只读模式下已存在的"转码中"视频节点仍然需要能追上
    // 最新状态（跟"是否允许发起新的上传"是两件不同的事，见 spec.md「转码完成后自动更新」）
  }, [pollVideoStatus]);

  useEffect(() => {
    setActiveVideoUploadErrorHandler(isEditable ? (onVideoUploadError ?? null) : null);
    return () => setActiveVideoUploadErrorHandler(null);
  }, [isEditable, onVideoUploadError]);

  // 图片/视频的上传请求已发出、但结果尚未插入编辑器内容这段窗口内，提示用户离开页面
  // 会丢失这次操作（见 document-editor spec.md「上传进行中离开页面提示」）——一旦
  // 结果已经插入节点（哪怕视频还在转码中），这个提示就不再需要（见组件外
  // `pending-upload-registry.ts` 顶部注释、upload-reliability-hardening design.md
  // 决策 3）。挂载时先读一次当前计数，避免"组件重新挂载时恰好有一次上传已经在
  // 进行中却没监听到"这种边界情况。
  useEffect(() => {
    function handleBeforeUnload(event: BeforeUnloadEvent): void {
      event.preventDefault();
      // 部分浏览器（尤其是较旧的实现）仍然依赖 `returnValue` 而不是 `preventDefault()`
      // 来判断是否要弹出确认框，两者都设置，兼容性更稳妥
      event.returnValue = '';
    }
    function syncListener(count: number): void {
      if (count > 0) {
        window.addEventListener('beforeunload', handleBeforeUnload);
      } else {
        window.removeEventListener('beforeunload', handleBeforeUnload);
      }
    }
    syncListener(getPendingUploadCount());
    const unsubscribe = subscribePendingUploadCount(syncListener);
    return () => {
      unsubscribe();
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, []);

  useEffect(() => {
    if (!fullscreen) return;
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') onFullscreenChange?.(false);
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [fullscreen, onFullscreenChange]);

  useEffect(() => {
    if (!previewSrc) return;
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') setPreviewSrc(null);
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [previewSrc]);

  function retrySave(): void {
    void performSave(latestContentRef.current);
  }

  // 标题输入框按 Enter 直接切到正文继续写，不需要先按 Tab/点一下鼠标
  function handleTitleKeyDown(event: ReactKeyboardEvent<HTMLInputElement>): void {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    editor.commands.focus('start');
  }

  // 图片双击预览：不用改造 `Image` 扩展成 NodeView，直接在内容区做一次事件委托——
  // 双击到的目标是编辑器渲染出来的 `<img class="doc-editor-image">` 就弹出大图；单击
  // 不拦截，交给 ProseMirror 原生的节点选中处理（见 document-editor spec.md
  // 「图片双击预览，单击选中」，跟飞书/Notion 单击选中、双击/独立入口才预览的习惯一致）
  function handleCanvasDoubleClick(event: ReactMouseEvent<HTMLDivElement>): void {
    const target = event.target;
    if (target instanceof HTMLImageElement && target.classList.contains('doc-editor-image')) {
      setPreviewSrc(target.src);
    }
  }

  return (
    <div className={cx('doc-editor', fullscreen && 'doc-editor--fullscreen', className)}>
      <div className="doc-editor__toolbar">
        <SaveStatusIndicator status={isEditable ? saveStatus : 'idle'} onRetry={retrySave} />

        {offline ? <span className="doc-editor__offline-badge">当前离线，暂不支持编辑</span> : null}

        <span className="doc-editor__spacer" />

        {onFullscreenChange ? (
          <button
            type="button"
            className="doc-editor__toolbar-btn"
            onClick={() => onFullscreenChange(!fullscreen)}
          >
            {fullscreen ? '退出全屏' : '全屏'}
          </button>
        ) : null}
      </div>

      <div className="doc-editor__body">
        <DocumentOutline editor={editor} />
        <div className="doc-editor__content-wrapper">
          <FormattingBubbleMenu editor={editor} />
          {/* biome-ignore lint/a11y/noStaticElementInteractions: 事件委托容器，实际可交互元素是里面的 <img>（本身就有 alt 文本），不是这层 div 本身 */}
          <div className="doc-editor__canvas" onDoubleClick={handleCanvasDoubleClick}>
            {onTitleChange ? (
              <input
                className="doc-editor__title"
                value={title ?? ''}
                onChange={event => onTitleChange(event.target.value)}
                onKeyDown={handleTitleKeyDown}
                placeholder={titlePlaceholder}
                disabled={!isEditable}
                aria-label="文档标题"
              />
            ) : null}
            <EditorContent editor={editor} className="doc-editor__content" />
          </div>
        </div>
      </div>

      {previewSrc ? (
        // biome-ignore lint/a11y/noStaticElementInteractions: 纯展示的全屏预览遮罩
        // biome-ignore lint/a11y/useKeyWithClickEvents: Esc 键已经能关闭（见上面的 effect），这里点击遮罩只是额外的鼠标快捷方式
        <div className="doc-editor-image-preview" onClick={() => setPreviewSrc(null)}>
          {/* `key` 用图片地址：每次打开一张新图都重新挂载，缩放/平移状态自动重置，
              不需要额外写一段"关闭时清零"的逻辑 */}
          <ZoomableMedia key={previewSrc}>
            <img src={previewSrc} alt="预览" />
          </ZoomableMedia>
        </div>
      ) : null}
    </div>
  );
}

interface SaveStatusIndicatorProps {
  status: SaveStatus;
  onRetry: () => void;
}

function SaveStatusIndicator({status, onRetry}: SaveStatusIndicatorProps) {
  if (status === 'idle') return null;
  if (status === 'saving') {
    return (
      <span className="doc-editor__save-status doc-editor__save-status--saving">保存中...</span>
    );
  }
  if (status === 'saved') {
    return <span className="doc-editor__save-status doc-editor__save-status--saved">已保存</span>;
  }
  return (
    <span className="doc-editor__save-status doc-editor__save-status--error">
      保存失败
      <button type="button" onClick={onRetry}>
        重试
      </button>
    </span>
  );
}
