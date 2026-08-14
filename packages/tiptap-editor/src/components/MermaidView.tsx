import {type NodeViewProps, NodeViewWrapper} from '@tiptap/react';
import type {MouseEvent as ReactMouseEvent} from 'react';
import {useEffect, useRef, useState} from 'react';
import {ZoomableMedia} from './ZoomableMedia';

/**
 * Mermaid 图表块的 NodeView：`editing` 态左右分栏（源码 + 实时预览），`display` 态只渲染
 * SVG（见 document-editor spec.md「Mermaid 图表块的编辑态与展示态」）。`mermaid` 库体积不小
 * 且大量访问 `window`/DOM，这里刻意用动态 `import()` 而不是模块顶层静态引入——一是避免没有
 * 插入任何图表的文档也要加载这个依赖，二是保证 Schema 定义本身
 * （`src/utils/mermaid-node.ts`）不依赖它，能被 `apps/api` 安全引入做内容校验。
 *
 * `display` 态的交互跟图片保持一致（见 document-editor spec.md「图片/图表双击预览」）：
 * 单击弹出全屏大图预览，双击才进入编辑态；单击后用一个短延时等待"是不是紧接着又点了
 * 一次"，是的话直接取消预览、走双击进编辑，避免双击时先闪一下预览遮罩。只读模式下没有
 * 编辑态可进，单击直接预览，不需要等这个延时。
 */
/** IntersectionObserver 的视口缓冲边距：取一屏左右的高度，给渲染留出提前量——快速滚动时
 * 图表在真正进入视口前已经开始渐染，避免用户看到"进入视口那一刻才突然出现"的闪烁（见
 * system-performance-hardening design.md Risks，倾向容忍极少数快速滚动场景下的短暂占位，
 * 换取大多数场景下的渲染成本下降）。 */
const VIEWPORT_BUFFER_MARGIN = '800px 0px';

export function MermaidView({node, updateAttributes, editor}: NodeViewProps) {
  const source = (node.attrs['source'] as string) ?? '';
  const mode = (node.attrs['mode'] as 'editing' | 'display') ?? 'display';
  const [draft, setDraft] = useState(source);
  const [error, setError] = useState<string | null>(null);
  const [svgMarkup, setSvgMarkup] = useState('');
  const [previewOpen, setPreviewOpen] = useState(false);
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  // 编辑态始终视为"在视口内"（见 document-editor-performance spec.md「编辑态的 Mermaid
  // 图表始终渐染」），跳过下面的 IntersectionObserver 判断；展示态默认先不触发渐染，等
  // IntersectionObserver 首次报告"进入/接近视口"才渲染一次。一旦渲染过，SVG 保留在内存里，
  // 不会因为之后离开视口而被清空——Mermaid 重渲染成本高、内存占用相对低，跟视频播放资源
  // 的取舍不是同一类权衡（见 system-performance-hardening design.md 决策 3）。
  const [hasBeenVisible, setHasBeenVisible] = useState(mode === 'editing');
  const readOnly = !editor.isEditable;

  useEffect(() => {
    setDraft(source);
  }, [source]);

  useEffect(() => {
    if (mode === 'editing' || hasBeenVisible) return;
    const el = wrapperRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      entries => {
        if (entries.some(entry => entry.isIntersecting)) setHasBeenVisible(true);
      },
      {rootMargin: VIEWPORT_BUFFER_MARGIN}
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [mode, hasBeenVisible]);

  const codeToRender = mode === 'editing' ? draft : source;
  const shouldRender = mode === 'editing' || hasBeenVisible;

  useEffect(() => {
    if (!shouldRender) return;
    if (!codeToRender.trim()) {
      setSvgMarkup('');
      setError(null);
      return;
    }

    let cancelled = false;
    void import('mermaid').then(async ({default: mermaid}) => {
      if (cancelled) return;
      mermaid.initialize({startOnLoad: false, securityLevel: 'strict'});
      try {
        const id = `doc-editor-mermaid-${Math.random().toString(36).slice(2)}`;
        const {svg} = await mermaid.render(id, codeToRender);
        if (!cancelled) {
          setSvgMarkup(svg);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : '图表语法错误');
      }
    });

    return () => {
      cancelled = true;
    };
  }, [codeToRender, shouldRender]);

  useEffect(() => {
    if (!previewOpen) return;
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') setPreviewOpen(false);
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [previewOpen]);

  useEffect(
    () => () => {
      if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
    },
    []
  );

  function handleConfirm(): void {
    updateAttributes({source: draft, mode: 'display'});
  }

  function handleClick(): void {
    if (mode !== 'display' || !source.trim()) return;
    if (readOnly) {
      setPreviewOpen(true);
      return;
    }
    // 等一小段时间，看看是不是紧接着又点了一次（= 双击进编辑态），
    // 是的话在 handleDoubleClick 里会直接清掉这个计时器，预览就不会弹出来
    if (clickTimerRef.current) return;
    clickTimerRef.current = setTimeout(() => {
      clickTimerRef.current = null;
      setPreviewOpen(true);
    }, 220);
  }

  function handleDoubleClick(): void {
    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    }
    if (readOnly || mode !== 'display') return;
    updateAttributes({mode: 'editing'});
  }

  function handleEditClick(event: ReactMouseEvent): void {
    event.stopPropagation();
    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    }
    updateAttributes({mode: 'editing'});
  }

  if (mode !== 'editing' || readOnly) {
    return (
      <>
        <NodeViewWrapper
          ref={wrapperRef}
          className="doc-editor-mermaid doc-editor-mermaid--display"
          onClick={handleClick}
          onDoubleClick={handleDoubleClick}
        >
          {!readOnly ? (
            <button
              type="button"
              className="doc-editor-mermaid__edit-btn"
              contentEditable={false}
              onClick={handleEditClick}
              aria-label="编辑 Mermaid 图表"
            >
              编辑
            </button>
          ) : null}
          {svgMarkup ? (
            <div
              className="doc-editor-mermaid__preview"
              // biome-ignore lint/security/noDangerouslySetInnerHtml: mermaid 以 `securityLevel: 'strict'` 渲染，输出已经过官方 XSS 过滤
              dangerouslySetInnerHTML={{__html: svgMarkup}}
            />
          ) : (
            <div className="doc-editor-mermaid__preview" />
          )}
          {!source.trim() ? (
            <p className="doc-editor-mermaid__placeholder">
              {readOnly ? '（空的图表）' : '双击编辑 Mermaid 图表'}
            </p>
          ) : null}
        </NodeViewWrapper>

        {previewOpen ? (
          // biome-ignore lint/a11y/noStaticElementInteractions: 纯展示的全屏预览遮罩
          // biome-ignore lint/a11y/useKeyWithClickEvents: Esc 键已经能关闭（见上面的 effect），点击遮罩只是额外的鼠标快捷方式
          <div className="doc-editor-image-preview" onClick={() => setPreviewOpen(false)}>
            {/* `key` 用图表源码：源码变了或者重新打开预览都重新挂载 ZoomableMedia，
                缩放/平移状态自动重置 */}
            <ZoomableMedia key={svgMarkup}>
              <div
                className="doc-editor-mermaid-preview"
                // biome-ignore lint/security/noDangerouslySetInnerHtml: 同上，mermaid strict 模式输出
                dangerouslySetInnerHTML={{__html: svgMarkup}}
              />
            </ZoomableMedia>
          </div>
        ) : null}
      </>
    );
  }

  return (
    <NodeViewWrapper
      className="doc-editor-mermaid doc-editor-mermaid--editing"
      contentEditable={false}
    >
      <div className="doc-editor-mermaid__pane">
        <textarea
          className="doc-editor-mermaid__source"
          value={draft}
          placeholder="输入 mermaid 图表代码..."
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault();
              handleConfirm();
            }
          }}
        />
        <div className="doc-editor-mermaid__preview-pane">
          {svgMarkup ? (
            <div
              className="doc-editor-mermaid__preview"
              // biome-ignore lint/security/noDangerouslySetInnerHtml: 同上，mermaid strict 模式输出
              dangerouslySetInnerHTML={{__html: svgMarkup}}
            />
          ) : (
            <div className="doc-editor-mermaid__preview" />
          )}
          {error ? <p className="doc-editor-mermaid__error">{error}</p> : null}
        </div>
      </div>
      <div className="doc-editor-mermaid__actions">
        <button type="button" onClick={handleConfirm}>
          完成
        </button>
      </div>
    </NodeViewWrapper>
  );
}
