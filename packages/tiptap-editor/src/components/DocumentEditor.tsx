import {Extension} from '@tiptap/core';
import {Collaboration} from '@tiptap/extension-collaboration';
import {CollaborationCaret} from '@tiptap/extension-collaboration-caret';
import {Placeholder} from '@tiptap/extension-placeholder';
import {EditorContent, ReactNodeViewRenderer, useEditor} from '@tiptap/react';
import {StarterKit} from '@tiptap/starter-kit';
import type {KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent} from 'react';
import {useEffect, useMemo, useRef, useState} from 'react';
import {useCollaborationCaretLabels} from '../hooks/use-collaboration-caret-labels';
import {useDocumentBlockCount} from '../hooks/use-document-block-count';
import {CodeBlockKeymap} from '../utils/code-block/code-block-keymap';
import {renderCaret, renderCaretSelection} from '../utils/collaboration/caret-render';
import {
  type CollaborationConfig,
  type CollaborationStatus,
  type CollaboratorInfo,
  type HistoricalEditorInfo,
  Y_TITLE_FRAGMENT_FIELD,
  Y_XML_FRAGMENT_FIELD
} from '../utils/collaboration/collaboration-types';
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
import {ImageBubbleMenu} from './ImageBubbleMenu';
import {MermaidView} from './MermaidView';
import {TableBubbleMenu} from './TableBubbleMenu';
import {VideoView} from './VideoView';
import {ZoomableMedia} from './ZoomableMedia';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

/** 建议拆分为子文档的内容块数量阈值：目前没有真实的"超大文档"样本数据，先给一个偏保守
 * 的默认值，后续可以根据真实使用情况调整，不是这次改动需要精确定案的事项（见
 * system-performance-hardening design.md Open Questions）。只统计顶层块数量
 * （`doc.childCount`），不做真正的内容虚拟化/强制限制——纯提示性质，不阻塞任何已有操作
 * （见 document-editor-performance spec.md「超大文档拆分引导」）。 */
const SPLIT_SUGGESTION_BLOCK_THRESHOLD = 300;

export interface DocumentEditorProps {
  /**
   * 初始内容（ProseMirror JSON）。只在组件首次挂载时读取一次，切换到另一篇文档时，
   * 消费方必须用不同的 `key`（例如 `key={documentId}`）强制重新挂载，而不是期望这个
   * 组件在同一个实例上"热切换"内容——这跟大多数富文本编辑器组件的使用约定一致。
   * 提供了 `collaboration` 时这个 prop 被忽略（内容真源变成传入的 `Y.Doc`），可以
   * 不传。
   */
  content?: unknown;
  /** 当前用户角色是否允许编辑（`VIEWER` 传 `false`，见 spec.md「只读模式」） */
  editable: boolean;
  /** 离线时强制只读，即使 `editable` 为 true（见 spec.md「离线只读缓存」） */
  offline?: boolean;
  /** 标题：跟正文同属一个可滚动内容区，渲染在内容顶部（跟飞书一致——标题是文档内容的
   * 第一行，会跟着正文一起滚动，不是页面级固定的一条通栏）。标题本身仍然不会被写进
   * `content` JSON 里。
   *
   * 协同模式（提供了 `collaboration`）下，标题不再是纯受控 `<input>`：内容真源变成
   * `collaboration.document` 上另一个共享 `XmlFragment`（见 collaborative-document-title
   * design.md 决策 1/2），由一个极简的内置 Tiptap 编辑器实例绑定，多人同时编辑会
   * CRDT 自动合并，这个 `title` prop 在协同模式下被忽略（跟正文的 `content` prop 是
   * 同一个道理）。`onTitleChange` 仍然会在标题变化时被调用（本地输入或远程合并都会
   * 触发），但语义变成"告诉外部现在的标题是什么"（供页面 `<title>`/面包屑展示），
   * 不再意味着"调用方需要负责持久化"——持久化已经完全交给协同层。
   *
   * 非协同模式下行为不变：`title`/`onTitleChange` 是一对标准的受控组件 prop，保存逻辑
   * 由消费方自己处理（跟 `onSave` 是同样的分工：组件只负责渲染和触发回调）。
   *
   * 两种模式下都是：不传 `onTitleChange` 时不渲染标题区域。 */
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
  /** 防抖结束后触发的保存回调；reject 会被捕获并展示为"保存失败"。协同模式下
   * （提供了 `collaboration`）这个回调不会被调用，可以不传 */
  onSave?: (json: unknown) => Promise<void>;
  onSaveStatusChange?: (status: SaveStatus) => void;
  fullscreen?: boolean;
  onFullscreenChange?: (next: boolean) => void;
  className?: string;
  /** 自动保存防抖时长（毫秒），默认 800ms（见 spec.md「停止输入后自动保存」）；
   * 协同模式下不生效（内容持久化由协同连接驱动，不再走离散的 `onSave` 调用） */
  autosaveDelay?: number;
  /**
   * 可选的实时协同配置（见 yjs-realtime-collaboration design.md 决策 8）：不传时
   * 编辑器行为跟接入协同能力之前完全一致（走 `StarterKit` 自带 history、本地状态
   * 管理、`onSave` 防抖保存）；传入时才装配 `Collaboration`/`CollaborationCaret`
   * 扩展、关闭默认 history，改用协同版 undo/redo，且忽略 `content`/`onSave`
   * （内容真源变成传入的 `Y.Doc`，不再是这两个 prop）。组件本身不创建/管理协同
   * 连接，`document`/`provider` 的生命周期完全由消费方负责。
   */
  collaboration?: CollaborationConfig;
  /** 协同模式下的同步连接状态展示（见 spec.md 修改后的「自动保存与状态反馈」需求），
   * 由消费方监听 provider 的连接/同步事件后传入；不传时默认展示"连接中"。
   * 未提供 `collaboration` 时这个 prop 被忽略。 */
  collaborationStatus?: CollaborationStatus;
  /** 协同连接异常时的重连入口回调；不传时"连接异常"提示不展示重连按钮 */
  onReconnect?: () => void;
  /**
   * 曾经编辑过这篇文档的人（历史编辑人，不要求当前在线），展示在标题下方，以
   * "头像 + 用户名"的列表形式呈现（跟当前在线协作者的头像堆叠是两种不同的展示，
   * 后者在工具栏、只是头像不带名字——见体验优化：协同能力之外，用户也想知道
   * "这篇文档大致被谁编辑过"）。消费方自己决定怎么取这份数据（如按 `DocumentVersion`
   * 的作者去重，理论上应该已经去重），本组件会再按 `id` 兜底去重一次，不传则不渲染。
   */
  historicalEditors?: HistoricalEditorInfo[];
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
  autosaveDelay = 800,
  collaboration,
  collaborationStatus = 'connecting',
  onReconnect,
  historicalEditors = []
}: DocumentEditorProps) {
  const isEditable = editable && !offline;
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [collaborators, setCollaborators] = useState<CollaboratorInfo[]>([]);
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestContentRef = useRef<unknown>(content);
  const canvasRef = useRef<HTMLDivElement | null>(null);

  // 防御性去重：消费方约定按用户 id 去重传入（见 apps/api 的 `listEditors`，DB 层
  // 已经 `distinct: ['createdBy']`），这里再按 `id` 兜底一次——本组件不应该假设
  // 所有消费方都严格遵守这个约定，重复渲染同一个人的头像是明显的体验 bug。
  const dedupedHistoricalEditors = useMemo(() => {
    const seen = new Set<string>();
    return historicalEditors.filter(editor => {
      if (seen.has(editor.id)) return false;
      seen.add(editor.id);
      return true;
    });
  }, [historicalEditors]);

  // 编辑器整套扩展配置（含 collaboration.document/collaboration.user）只在挂载时读一次
  // 快照，切换协同配置要靠外层 key 强制重新挂载，不是在同一个实例上热切换（跟 content/
  // useEditor 是同一个约定，见组件顶部 content prop 的注释）。
  // biome-ignore lint/correctness/useExhaustiveDependencies: 见上面注释，故意只挂载时读一次快照，不跟随 collaboration.document/collaboration.user 变化重新计算
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
        // 协同模式下必须关闭 StarterKit 自带的 history，改用 Collaboration 扩展自带的
        // 协同版 undo/redo（见 design.md 决策 8），否则本地 undo 栈会跟协同状态冲突。
        if (extension.name === 'starterKit' && collaboration) {
          return extension.configure({undoRedo: false});
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
      CodeBlockKeymap,
      ...(collaboration
        ? [
            Collaboration.configure({
              document: collaboration.document,
              field: Y_XML_FRAGMENT_FIELD
            }),
            CollaborationCaret.configure({
              provider: collaboration.provider,
              user: collaboration.user,
              render: renderCaret,
              selectionRender: renderCaretSelection
            })
          ]
        : [])
    ],
    []
  );

  function updateSaveStatus(status: SaveStatus): void {
    setSaveStatus(status);
    onSaveStatusChange?.(status);
  }

  async function performSave(json: unknown): Promise<void> {
    if (!onSave) return;
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
      // 协同模式下内容真源是传入的 Y.Doc（由 Collaboration 扩展接管），不能再传
      // `content`——两者同时存在会跟 ySyncPlugin 的内容管理冲突。
      content: collaboration ? undefined : (content as object),
      editable: isEditable,
      // 协同模式下不走离散的防抖保存：内容持久化由协同连接驱动（见
      // apps/collab-server 的周期性持久化），`onSave` 在这个模式下不生效。
      onUpdate: collaboration ? undefined : ({editor: instance}) => scheduleSave(instance.getJSON())
    },
    []
  );

  useEffect(() => {
    editor.setEditable(isEditable);
  }, [editor, isEditable]);

  // 标题的极简编辑器实例（见 collaborative-document-title design.md 决策 2）：只装配
  // `Document`/`Paragraph`/`Text` 三个节点（`StarterKit` 里其余全部子扩展显式关闭），
  // 保证标题永远是单段落纯文本，不支持任何 mark；`Enter`/`Shift-Enter` 拦截掉——按
  // Enter 直接把焦点切给正文（跟原来纯 `<input>` 时代的 `handleTitleKeyDown` 是同一个
  // 交互，这里换成 Tiptap 扩展的 `addKeyboardShortcuts` 实现），不允许在标题里换行。
  // 跟主编辑器的 `extensions` 一样只在挂载时读一次快照（`useMemo(..., [])`），协同配置/
  // placeholder 文案变化需要靠外层 `key` 强制重新挂载。
  // biome-ignore lint/correctness/useExhaustiveDependencies: 故意只挂载时读一次快照，理由同主编辑器 extensions 的注释
  const titleExtensions = useMemo(() => {
    const shared = [
      StarterKit.configure({
        blockquote: false,
        bold: false,
        bulletList: false,
        code: false,
        codeBlock: false,
        dropcursor: false,
        gapcursor: false,
        hardBreak: false,
        heading: false,
        horizontalRule: false,
        italic: false,
        link: false,
        listItem: false,
        listKeymap: false,
        orderedList: false,
        strike: false,
        underline: false,
        trailingNode: false,
        // 标题不需要自己的撤销栈：非协同模式下复用主编辑器/消费方自己的保存节奏，
        // 协同模式下跟正文一样改用 Collaboration 扩展自带的协同版 undo/redo。
        undoRedo: false
      }),
      Placeholder.configure({placeholder: titlePlaceholder}),
      Extension.create({
        name: 'titleKeymap',
        addKeyboardShortcuts() {
          return {
            Enter: () => {
              editor.commands.focus('start');
              return true;
            },
            'Shift-Enter': () => true
          };
        }
      })
    ];
    if (!collaboration) return shared;
    return [
      ...shared,
      Collaboration.configure({
        document: collaboration.document,
        field: Y_TITLE_FRAGMENT_FIELD
      })
    ];
  }, []);

  const titleEditor = useEditor(
    {
      extensions: titleExtensions,
      // 非协同模式下才用这个初始值（只在挂载时读一次，跟主编辑器 content prop 同一个
      // 约定）；协同模式下内容真源是 Y.Doc 上的 title XmlFragment，忽略这个值。
      content: collaboration
        ? undefined
        : {
            type: 'doc',
            content: [{type: 'paragraph', content: title ? [{type: 'text', text: title}] : []}]
          },
      editable: isEditable,
      onUpdate: ({editor: instance}) => onTitleChange?.(instance.getText())
    },
    []
  );

  useEffect(() => {
    titleEditor.setEditable(isEditable);
  }, [titleEditor, isEditable]);

  // 超大文档拆分引导：只读顶层块数量，纯提示、不阻塞编辑（见 document-editor-performance
  // spec.md「超大文档拆分引导」）。这个统计跟 `onSave`/协同同步走的是完全独立的路径——
  // 只订阅 `editor.on('update', ...)` 读一个数字，不参与、也不影响任何保存/同步逻辑。
  const blockCount = useDocumentBlockCount(editor);
  const showSplitSuggestion = blockCount > SPLIT_SUGGESTION_BLOCK_THRESHOLD;

  // 协作者光标用户名标签的位置（覆盖层方案，修复 `content-visibility: auto` 会把标签
  // 裁掉一部分的显示 bug，见 hooks/use-collaboration-caret-labels.ts 顶部详细说明）。
  const caretLabels = useCollaborationCaretLabels(editor, canvasRef, Boolean(collaboration));

  // 协作者 presence：不依赖 CollaborationCaret 内部的 storage（那是给编辑区域内的
  // 光标/选区标记用的，跟"在线用户列表"是两个独立的展示需求），直接监听
  // `provider.awareness` 的变化自己维护一份列表（见 realtime-collaboration
  // spec.md「展示在线协作者列表」）。同时把当前用户信息写入本地 awareness 状态，
  // 保证其他协作者能看到"我"（`CollaborationCaret` 通常也会做这件事，这里显式写一次
  // 是为了不依赖它的内部时序，两者都写是幂等的，不会冲突）。
  useEffect(() => {
    if (!collaboration) {
      setCollaborators([]);
      return;
    }
    const {awareness} = collaboration.provider;
    awareness.setLocalStateField('user', collaboration.user);

    function syncCollaborators(): void {
      const entries = Array.from(awareness.getStates().entries()) as Array<
        [number, {user?: {name?: string; color?: string; avatarUrl?: string | null}}]
      >;
      setCollaborators(
        entries
          .filter(([clientId]) => clientId !== awareness.clientID)
          .map(([clientId, state]) => ({
            clientId,
            name: state.user?.name ?? '匿名用户',
            color: state.user?.color ?? '#999999',
            avatarUrl: state.user?.avatarUrl ?? null
          }))
      );
    }

    syncCollaborators();
    awareness.on('change', syncCollaborators);
    return () => awareness.off('change', syncCollaborators);
  }, [collaboration]);

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
        {collaboration ? (
          <CollaborationStatusIndicator status={collaborationStatus} onReconnect={onReconnect} />
        ) : (
          <SaveStatusIndicator status={isEditable ? saveStatus : 'idle'} onRetry={retrySave} />
        )}

        {offline ? <span className="doc-editor__offline-badge">当前离线，暂不支持编辑</span> : null}

        {showSplitSuggestion ? (
          <span className="doc-editor__split-suggestion">内容较多，建议拆分为多篇子文档</span>
        ) : null}

        {collaboration && collaborators.length > 0 ? (
          <div
            className="doc-editor__collaborators"
            title={collaborators.map(collaborator => collaborator.name).join('、')}
          >
            {collaborators.slice(0, 5).map(collaborator => (
              <CollaboratorAvatar key={collaborator.clientId} collaborator={collaborator} />
            ))}
          </div>
        ) : null}

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
          <ImageBubbleMenu editor={editor} />
          <TableBubbleMenu editor={editor} />
          {/* biome-ignore lint/a11y/noStaticElementInteractions: 事件委托容器，实际可交互元素是里面的 <img>（本身就有 alt 文本），不是这层 div 本身 */}
          <div
            className="doc-editor__canvas"
            ref={canvasRef}
            onDoubleClick={handleCanvasDoubleClick}
          >
            {onTitleChange ? (
              collaboration ? (
                <EditorContent
                  editor={titleEditor}
                  className="doc-editor__title doc-editor__title-editor"
                  aria-label="文档标题"
                />
              ) : (
                <input
                  className="doc-editor__title"
                  value={title ?? ''}
                  onChange={event => onTitleChange(event.target.value)}
                  onKeyDown={handleTitleKeyDown}
                  placeholder={titlePlaceholder}
                  disabled={!isEditable}
                  aria-label="文档标题"
                />
              )
            ) : null}

            {dedupedHistoricalEditors.length > 0 ? (
              <ul className="doc-editor__history-editors" aria-label="历史编辑人">
                {dedupedHistoricalEditors.map(editor => (
                  <li key={editor.id} className="doc-editor__history-editor">
                    <CollaboratorAvatar collaborator={editor} muted />
                    <span className="doc-editor__history-editor-name">{editor.name}</span>
                  </li>
                ))}
              </ul>
            ) : null}

            <EditorContent editor={editor} className="doc-editor__content" />

            {collaboration && caretLabels.length > 0 ? (
              <div className="doc-editor-caret-overlay" aria-hidden="true">
                {caretLabels.map(label => (
                  <span
                    key={label.key}
                    className="doc-editor-caret__label"
                    style={{top: label.top, left: label.left, backgroundColor: label.color}}
                  >
                    {label.name}
                  </span>
                ))}
              </div>
            ) : null}
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

interface CollaboratorAvatarProps {
  collaborator: {name: string; color: string; avatarUrl?: string | null};
  /** 历史编辑人（非当前在线）用这个视觉上跟"正在协同"的头像区分开，不用另起一套组件 */
  muted?: boolean;
}

/**
 * 单个协作者/历史编辑人的头像展示：有 `avatarUrl` 就显示真实头像图，加载失败或
 * 没有 `avatarUrl` 时退回用户名首字母的纯色圆圈——跟 `apps/web` 的 `UserAvatar`
 * 是同一套兜底思路，这里独立实现一份（本包不依赖 apps/web 的组件）。
 */
function CollaboratorAvatar({collaborator, muted = false}: CollaboratorAvatarProps) {
  const [errored, setErrored] = useState(false);
  const className = cx(
    'doc-editor__collaborator-avatar',
    muted && 'doc-editor__collaborator-avatar--muted'
  );

  if (collaborator.avatarUrl && !errored) {
    return (
      <img
        src={collaborator.avatarUrl}
        alt={collaborator.name}
        className={className}
        onError={() => setErrored(true)}
      />
    );
  }
  return (
    <span className={className} style={{backgroundColor: collaborator.color}}>
      {collaborator.name.slice(0, 1).toUpperCase()}
    </span>
  );
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

interface CollaborationStatusIndicatorProps {
  status: CollaborationStatus;
  onReconnect?: () => void;
}

/**
 * 对应 document-editor spec.md 修改后的「自动保存与状态反馈」需求：协同模式下
 * 展示的是同步连接状态（同步中/已同步/连接异常+重连），不是某一次离散保存请求的
 * 成败——跟 `SaveStatusIndicator` 是平行的两套展示，二选一渲染（见组件顶部
 * `collaboration` prop 的判断），不共享状态。
 */
function CollaborationStatusIndicator({status, onReconnect}: CollaborationStatusIndicatorProps) {
  if (status === 'connecting') {
    return (
      <span className="doc-editor__save-status doc-editor__save-status--saving">同步中...</span>
    );
  }
  if (status === 'synced') {
    return <span className="doc-editor__save-status doc-editor__save-status--saved">已同步</span>;
  }
  return (
    <span className="doc-editor__save-status doc-editor__save-status--error">
      连接异常
      {onReconnect ? (
        <button type="button" onClick={onReconnect}>
          重连
        </button>
      ) : null}
    </span>
  );
}
