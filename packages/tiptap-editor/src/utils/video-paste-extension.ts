import {Extension} from '@tiptap/core';
import {Plugin} from '@tiptap/pm/state';

/** 只匹配"整段粘贴内容就是一个 .m3u8 地址"，不影响正文里夹带链接的普通文本粘贴
 * （跟 `link-preview-extension.ts` 的 `URL_ONLY_PATTERN` 同一个思路，范围更窄） */
const M3U8_URL_PATTERN = /^https?:\/\/\S+\.m3u8(\?\S*)?$/i;

/**
 * 粘贴外部 HLS（`.m3u8`）地址时直接插入一个"已就绪"状态的视频块，不经过任何上传/转码
 * 请求（见 document-editor spec.md「粘贴外部 HLS 地址插入」）。必须在 `components/
 * DocumentEditor.tsx` 的 extensions 数组里排在 `LinkPreviewPaste` **之后**（见那边的
 * 顺序注释——Tiptap 构建 ProseMirror 插件列表时会整体反转 extensions 数组，数组里排得
 * 越靠后的扩展，插件优先级越高）。两者的 `handlePaste` 都会尝试匹配纯 URL 粘贴，第一个
 * 返回 `true` 的会拦下这次粘贴；`LinkPreviewPaste` 的 `URL_ONLY_PATTERN` 是"任意 URL"
 * 的更宽泛匹配，如果它的优先级更高，`.m3u8` 地址会被误判成普通链接、弹出"纯链接/预览
 * 卡片"选择框，而不是插入视频。
 */
export const VideoPastePattern = Extension.create({
  name: 'videoPastePattern',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          handlePaste(view, event) {
            const text = event.clipboardData?.getData('text/plain')?.trim();
            if (!text || !M3U8_URL_PATTERN.test(text)) return false;

            const videoType = view.state.schema.nodes['video'];
            if (!videoType) return false;

            event.preventDefault();
            const {from} = view.state.selection;
            const tr = view.state.tr.insert(
              from,
              videoType.create({
                sourceType: 'external',
                assetId: null,
                hlsUrl: text,
                posterUrl: null,
                status: 'ready',
                error: null
              })
            );
            view.dispatch(tr);
            return true;
          }
        }
      })
    ];
  }
});
