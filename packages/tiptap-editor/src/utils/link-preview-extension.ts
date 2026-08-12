import type {Editor} from '@tiptap/core';
import {Extension} from '@tiptap/core';
import {Plugin} from '@tiptap/pm/state';
import {ReactRenderer} from '@tiptap/react';
import {LinkPasteChooser} from '../components/LinkPasteChooser';
import {getActiveLinkPreviewFetcher} from './link-preview-registry';

const URL_ONLY_PATTERN = /^https?:\/\/\S+$/i;

function insertPlainLink(editor: Editor, url: string, pos: number): void {
  editor
    .chain()
    .insertContentAt(pos, {type: 'text', text: url, marks: [{type: 'link', attrs: {href: url}}]})
    .run();
}

function showChooser(editor: Editor, url: string, pos: number): void {
  let renderer: ReactRenderer | null = null;

  function cleanup(): void {
    renderer?.element.remove();
    renderer?.destroy();
    renderer = null;
    document.removeEventListener('mousedown', handleOutsideClick, true);
    document.removeEventListener('keydown', handleKeyDown, true);
  }

  function handleOutsideClick(event: MouseEvent): void {
    if (renderer && !renderer.element.contains(event.target as Node)) cleanup();
  }

  function handleKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') cleanup();
  }

  async function handleChoose(choice: 'plain' | 'card'): Promise<void> {
    cleanup();
    if (choice === 'plain') {
      insertPlainLink(editor, url, pos);
      return;
    }
    const fetcher = getActiveLinkPreviewFetcher();
    const result = fetcher ? await fetcher(url) : null;
    if (!result) {
      // 抓取失败自动降级为纯文本链接（见 link-preview spec.md「抓取失败时自动降级」）
      insertPlainLink(editor, url, pos);
      return;
    }
    editor
      .chain()
      .insertContentAt(pos, {type: 'linkPreviewCard', attrs: {url, ...result}})
      .run();
  }

  renderer = new ReactRenderer(LinkPasteChooser, {props: {url, onChoose: handleChoose}, editor});

  const coords = editor.view.coordsAtPos(pos);
  const element = renderer.element as HTMLElement;
  element.style.position = 'fixed';
  element.style.left = `${coords.left}px`;
  element.style.top = `${coords.bottom + 4}px`;
  element.style.zIndex = '50';
  document.body.append(element);

  document.addEventListener('mousedown', handleOutsideClick, true);
  document.addEventListener('keydown', handleKeyDown, true);
}

/**
 * 粘贴纯 URL 时拦截默认粘贴行为，弹出"纯链接/预览卡片"选择（见 link-preview spec.md）。
 * 只在粘贴内容"整段就是一个 URL"时触发，不影响正文里夹带链接的普通文本粘贴。
 */
export const LinkPreviewPaste = Extension.create({
  name: 'linkPreviewPaste',

  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin({
        props: {
          handlePaste(view, event) {
            const text = event.clipboardData?.getData('text/plain')?.trim();
            if (!text || !URL_ONLY_PATTERN.test(text)) return false;
            event.preventDefault();
            showChooser(editor, text, view.state.selection.from);
            return true;
          }
        }
      })
    ];
  }
});
