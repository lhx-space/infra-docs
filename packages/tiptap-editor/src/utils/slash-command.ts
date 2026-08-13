import type {Editor, Range} from '@tiptap/core';
import {Extension} from '@tiptap/core';
import {ReactRenderer} from '@tiptap/react';
import Suggestion, {type SuggestionOptions} from '@tiptap/suggestion';
import {SlashCommandMenu, type SlashCommandMenuHandle} from '../components/SlashCommandMenu';
import {getActiveImageUploader} from './image-uploader-registry';
import {startImageUpload} from './upload-image-plugin';
import {getActiveVideoUploadErrorHandler} from './video-upload-error-registry';
import {beginVideoUpload, endVideoUpload, getActiveVideoUploader} from './video-uploader-registry';

export interface SlashCommandItem {
  title: string;
  description: string;
  keywords: string[];
  run: (editor: Editor, range: Range) => void;
}

/**
 * 斜杠命令的候选项列表（见 document-editor spec.md「斜杠命令插入菜单」）。图片这一项
 * 复用工具栏/粘贴共用的 `startImageUpload` 流程，不重新实现一套上传逻辑
 * （见 spec.md「图片插入、上传交互与展示限制」）。
 */
export const SLASH_COMMAND_ITEMS: SlashCommandItem[] = [
  {
    title: '标题 1',
    description: '大标题',
    keywords: ['heading1', 'h1', '标题'],
    run: (editor, range) =>
      editor.chain().focus().deleteRange(range).setNode('heading', {level: 1}).run()
  },
  {
    title: '标题 2',
    description: '中标题',
    keywords: ['heading2', 'h2', '标题'],
    run: (editor, range) =>
      editor.chain().focus().deleteRange(range).setNode('heading', {level: 2}).run()
  },
  {
    title: '标题 3',
    description: '小标题',
    keywords: ['heading3', 'h3', '标题'],
    run: (editor, range) =>
      editor.chain().focus().deleteRange(range).setNode('heading', {level: 3}).run()
  },
  {
    title: '无序列表',
    description: '创建一个无序列表',
    keywords: ['bulletlist', 'ul', '列表'],
    run: (editor, range) => editor.chain().focus().deleteRange(range).toggleBulletList().run()
  },
  {
    title: '有序列表',
    description: '创建一个有序列表',
    keywords: ['orderedlist', 'ol', '列表'],
    run: (editor, range) => editor.chain().focus().deleteRange(range).toggleOrderedList().run()
  },
  {
    title: '任务列表',
    description: '创建一个待办事项列表',
    keywords: ['tasklist', 'todo', '待办'],
    run: (editor, range) => editor.chain().focus().deleteRange(range).toggleTaskList().run()
  },
  {
    title: '引用',
    description: '插入一段引用',
    keywords: ['quote', 'blockquote', '引用'],
    run: (editor, range) => editor.chain().focus().deleteRange(range).toggleBlockquote().run()
  },
  {
    title: '代码块',
    description: '插入一个带语法高亮的代码块',
    keywords: ['code', 'codeblock', '代码'],
    run: (editor, range) => editor.chain().focus().deleteRange(range).toggleCodeBlock().run()
  },
  {
    title: '分割线',
    description: '插入一条分割线',
    keywords: ['divider', 'hr', '分割线'],
    run: (editor, range) => editor.chain().focus().deleteRange(range).setHorizontalRule().run()
  },
  {
    title: 'Mermaid 图表',
    description: '插入一个可编辑的 Mermaid 图表',
    keywords: ['mermaid', 'diagram', '图表', '流程图'],
    run: (editor, range) => editor.chain().focus().deleteRange(range).insertMermaid().run()
  },
  {
    title: '图片',
    description: '从本地上传一张图片',
    keywords: ['image', 'picture', '图片'],
    run: (editor, range) => {
      editor.chain().focus().deleteRange(range).run();
      const uploadImage = getActiveImageUploader();
      if (!uploadImage) return;
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.onchange = () => {
        const file = input.files?.[0];
        if (file) startImageUpload(editor.view, file, uploadImage);
      };
      input.click();
    }
  },
  {
    title: '视频',
    description: '从本地上传一个视频（也可以直接粘贴外部 HLS 地址插入）',
    keywords: ['video', '视频'],
    run: (editor, range) => {
      editor.chain().focus().deleteRange(range).run();
      const uploadVideo = getActiveVideoUploader();
      if (!uploadVideo) return;
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'video/*';
      input.onchange = () => {
        const file = input.files?.[0];
        if (!file) return;
        beginVideoUpload();
        uploadVideo(file).then(
          result => {
            editor
              .chain()
              .focus()
              .insertVideo({
                sourceType: 'upload',
                assetId: result.assetId,
                hlsUrl: result.hlsUrl,
                posterUrl: result.posterUrl,
                status: result.status,
                error: result.error
              })
              .run();
            endVideoUpload();
          },
          () => {
            getActiveVideoUploadErrorHandler()?.('视频上传失败');
            endVideoUpload();
          }
        );
      };
      input.click();
    }
  }
];

/** 大小写不敏感地按标题/关键字过滤，空 query 时展示全部候选项 */
function filterItems(query: string): SlashCommandItem[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return SLASH_COMMAND_ITEMS;
  return SLASH_COMMAND_ITEMS.filter(
    item =>
      item.title.toLowerCase().includes(normalized) ||
      item.keywords.some(keyword => keyword.toLowerCase().includes(normalized))
  );
}

function positionMenu(element: HTMLElement, rect: DOMRect | null | undefined): void {
  if (!rect) return;
  element.style.position = 'fixed';
  element.style.left = `${rect.left}px`;
  element.style.top = `${rect.bottom + 4}px`;
  element.style.zIndex = '50';
}

/**
 * `/` 触发的插入菜单（见 spec.md「触发斜杠菜单」「继续输入过滤菜单项」）。用
 * `@tiptap/suggestion` 处理触发字符/范围计算，`ReactRenderer` 挂载 `SlashCommandMenu`
 * 到 `document.body`（固定定位，不受编辑器内部滚动容器影响）。
 */
export const SlashCommand = Extension.create({
  name: 'slashCommand',

  addOptions() {
    return {
      suggestion: {
        char: '/',
        allowSpaces: false,
        startOfLine: false,
        command: ({editor, range, props}) => {
          (props as SlashCommandItem).run(editor, range);
        }
      } satisfies Partial<SuggestionOptions<SlashCommandItem>>
    };
  },

  addProseMirrorPlugins() {
    return [
      Suggestion<SlashCommandItem>({
        editor: this.editor,
        char: '/',
        allowSpaces: false,
        startOfLine: false,
        items: ({query}) => filterItems(query),
        command: ({editor, range, props}) => props.run(editor, range),
        render: () => {
          let renderer: ReactRenderer<SlashCommandMenuHandle> | null = null;

          return {
            onStart: props => {
              renderer = new ReactRenderer(SlashCommandMenu, {
                props: {items: props.items, onSelect: props.command},
                editor: props.editor
              });
              document.body.append(renderer.element);
              positionMenu(renderer.element as HTMLElement, props.clientRect?.() ?? null);
            },
            onUpdate: props => {
              renderer?.updateProps({items: props.items, onSelect: props.command});
              positionMenu(renderer?.element as HTMLElement, props.clientRect?.() ?? null);
            },
            onKeyDown: props => {
              if (props.event.key === 'Escape') {
                renderer?.destroy();
                renderer = null;
                return true;
              }
              return renderer?.ref?.onKeyDown(props.event) ?? false;
            },
            onExit: () => {
              renderer?.element.remove();
              renderer?.destroy();
              renderer = null;
            }
          };
        }
      })
    ];
  }
});
