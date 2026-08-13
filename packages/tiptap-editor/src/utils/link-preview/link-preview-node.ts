import {mergeAttributes, Node} from '@tiptap/core';

export interface LinkPreviewCardAttrs {
  url: string;
  title?: string | null;
  description?: string | null;
  image?: string | null;
  favicon?: string | null;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    linkPreviewCard: {
      insertLinkPreviewCard: (attrs: LinkPreviewCardAttrs) => ReturnType;
    };
  }
}

/**
 * 第三方链接预览卡片的 Schema 定义（见 link-preview spec.md）。用 `renderHTML` 的嵌套数组
 * 语法直接产出卡片的完整 DOM 结构，不需要额外的 React NodeView——展示态是纯静态的
 * 标题/描述/图片/favicon 排版，没有交互，用 Schema 层的 `renderHTML` 就足够。
 */
export const LinkPreviewCard = Node.create({
  name: 'linkPreviewCard',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      url: {default: ''},
      title: {default: null},
      description: {default: null},
      image: {default: null},
      favicon: {default: null}
    };
  },

  parseHTML() {
    return [{tag: 'a[data-type="link-preview-card"]'}];
  },

  renderHTML({HTMLAttributes, node}) {
    const url = node.attrs['url'] as string;
    const title = node.attrs['title'] as string | null;
    const description = node.attrs['description'] as string | null;
    const image = node.attrs['image'] as string | null;
    const favicon = node.attrs['favicon'] as string | null;

    return [
      'a',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'link-preview-card',
        href: url,
        target: '_blank',
        rel: 'noopener noreferrer nofollow',
        class: 'doc-editor-link-card'
      }),
      ...(image
        ? [['img', {src: image, class: 'doc-editor-link-card__image', loading: 'lazy'}]]
        : []),
      [
        'div',
        {class: 'doc-editor-link-card__body'},
        ['div', {class: 'doc-editor-link-card__title'}, title || url],
        ...(description ? [['p', {class: 'doc-editor-link-card__description'}, description]] : []),
        [
          'div',
          {class: 'doc-editor-link-card__meta'},
          ...(favicon ? [['img', {src: favicon, class: 'doc-editor-link-card__favicon'}]] : []),
          ['span', {class: 'doc-editor-link-card__url'}, url]
        ]
      ]
    ] as never;
  },

  addCommands() {
    return {
      insertLinkPreviewCard:
        (attrs: LinkPreviewCardAttrs) =>
        ({commands}) =>
          commands.insertContent({type: this.name, attrs})
    };
  }
});
