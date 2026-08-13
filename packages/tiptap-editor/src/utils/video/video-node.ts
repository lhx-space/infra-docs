import {mergeAttributes, Node} from '@tiptap/core';

export type VideoSourceType = 'upload' | 'external';
export type VideoStatus = 'processing' | 'ready' | 'failed';

export interface VideoAttrs {
  sourceType: VideoSourceType;
  assetId?: string | null;
  hlsUrl?: string | null;
  posterUrl?: string | null;
  status: VideoStatus;
  error?: string | null;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    video: {
      /** 插入一个视频块——`upload` 来源插入时 `status` 通常是 `'processing'`（转码中），
       * `external` 来源（粘贴 `.m3u8` 地址）插入时直接是 `'ready'`（见 document-editor
       * spec.md「视频插入来源」） */
      insertVideo: (attrs: VideoAttrs) => ReturnType;
    };
  }
}

/**
 * 视频块的 Schema 定义（不含 NodeView，见 src/utils/extensions.ts 顶部注释——这份配置
 * 同时被 `apps/api` 的内容安全校验和本包主入口的可编辑渲染复用，见 video-hls-embed
 * design.md 决策 7）。转码是否完成靠 `status` 三态区分：
 * - `processing`：上传来源已创建转码任务但还没完成，`hlsUrl`/`posterUrl` 均为空
 * - `ready`：可播放，`hlsUrl` 必有值，`posterUrl` 通常有值（外部来源可能没有封面帧）
 * - `failed`：转码失败，`error` 有值
 *
 * `assetId` 只有 `sourceType: 'upload'` 时才有值，用于渲染层轮询转码状态
 * （见 utils/video-status-registry.ts）；`external` 来源不存在对应的后端资产记录。
 */
export const VideoBlock = Node.create({
  name: 'video',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      sourceType: {default: 'upload'},
      assetId: {default: null},
      hlsUrl: {default: null},
      posterUrl: {default: null},
      status: {default: 'processing'},
      error: {default: null}
    };
  },

  parseHTML() {
    return [{tag: 'div[data-type="video"]'}];
  },

  renderHTML({HTMLAttributes, node}) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'video',
        'data-source-type': node.attrs['sourceType'] as string,
        'data-asset-id': (node.attrs['assetId'] as string | null) ?? '',
        'data-hls-url': (node.attrs['hlsUrl'] as string | null) ?? '',
        'data-poster-url': (node.attrs['posterUrl'] as string | null) ?? '',
        'data-status': node.attrs['status'] as string
      })
    ];
  },

  addCommands() {
    return {
      insertVideo:
        (attrs: VideoAttrs) =>
        ({commands}) =>
          commands.insertContent({type: this.name, attrs})
    };
  }
});
