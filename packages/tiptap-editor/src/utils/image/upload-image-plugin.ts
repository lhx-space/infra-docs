import type {EditorState} from '@tiptap/pm/state';
import {Plugin, PluginKey} from '@tiptap/pm/state';
import type {EditorView} from '@tiptap/pm/view';
import {Decoration, DecorationSet} from '@tiptap/pm/view';
import {beginPendingUpload, endPendingUpload} from '../shared/pending-upload-registry';
import {getActiveImageUploadErrorHandler} from './image-upload-error-registry';
import {getActiveImageUploader} from './image-uploader-registry';

/**
 * 图片上传的"加载占位"实现：用 ProseMirror 的 Decoration（纯展示层，不写入文档内容）
 * 挂一个临时的 loading 小组件在插入位置，上传成功后再真正插入 image 节点、移除 decoration；
 * 失败则只移除 decoration，不留下任何图片节点（见 document-editor spec.md「上传中的加载状态」
 * /「上传失败的处理」）。用 decoration 而不是先插入一个"占位属性"的 image 节点，是为了避免
 * 上传过程中恰好触发自动保存，把"正在上传中"这种瞬时 UI 状态意外持久化进 `content` JSON。
 */
const uploadKey = new PluginKey<DecorationSet>('docEditorImageUpload');

interface UploadMeta {
  add?: {id: string; pos: number};
  remove?: {id: string};
}

export const imageUploadPlugin = new Plugin<DecorationSet>({
  key: uploadKey,
  state: {
    init() {
      return DecorationSet.empty;
    },
    apply(tr, value) {
      let set = value.map(tr.mapping, tr.doc);
      const meta = tr.getMeta(uploadKey) as UploadMeta | undefined;
      if (meta?.add) {
        const widget = document.createElement('span');
        widget.className = 'doc-editor-image-uploading';
        widget.setAttribute('data-upload-id', meta.add.id);
        set = set.add(tr.doc, [
          Decoration.widget(meta.add.pos, widget, {id: meta.add.id} as never)
        ]);
      } else if (meta?.remove) {
        const target = set.find(undefined, undefined, spec => spec.id === meta.remove?.id);
        set = set.remove(target);
      }
      return set;
    }
  },
  props: {
    decorations(state) {
      return uploadKey.getState(state);
    },
    // 粘贴/拖拽图片文件时复用同一条上传流程（见 spec.md「粘贴图片」），上传器来自
    // `image-uploader-registry.ts` 这个模块级注册表——ProseMirror Plugin 是静态定义，
    // 拿不到 `DocumentEditor` 组件的 props，跟斜杠命令的"图片"候选项是同一个桥接方式。
    handlePaste(view, event) {
      const files = Array.from(event.clipboardData?.files ?? []).filter(file =>
        file.type.startsWith('image/')
      );
      const uploader = getActiveImageUploader();
      if (files.length === 0 || !uploader) return false;
      for (const file of files) startImageUpload(view, file, uploader);
      return true;
    },
    handleDrop(view, event) {
      const files = Array.from(event.dataTransfer?.files ?? []).filter(file =>
        file.type.startsWith('image/')
      );
      const uploader = getActiveImageUploader();
      if (files.length === 0 || !uploader) return false;
      event.preventDefault();
      for (const file of files) startImageUpload(view, file, uploader);
      return true;
    }
  }
});

let uploadCounter = 0;

/**
 * 触发一次图片上传：立刻在当前选区位置挂一个 loading decoration，`uploadImage` resolve 后
 * 在同一位置插入真正的 image 节点并移除 decoration；reject 时只移除 decoration
 * （见 spec.md「通过工具栏插入图片」「粘贴图片」共用同一条流程）。
 *
 * 这是粘贴/拖拽/斜杠命令三个入口共用的唯一上传函数（见本文件顶部 Plugin 定义与
 * `utils/slash-command.ts` 的"图片"候选项），在这一处调用
 * `beginPendingUpload()`/`endPendingUpload()`（见 upload-reliability-hardening
 * design.md 决策 3）就天然覆盖了全部图片上传入口，不需要在每个调用点分别处理；
 * `endPendingUpload()` 在成功插入节点和失败提示错误两条路径都会执行，保证计数正确清零。
 */
export function startImageUpload(
  view: EditorView,
  file: File,
  uploadImage: (file: File) => Promise<string>,
  onError?: (message: string) => void
): void {
  uploadCounter += 1;
  const id = `upload-${uploadCounter}`;
  const pos = view.state.selection.from;

  view.dispatch(view.state.tr.setMeta(uploadKey, {add: {id, pos}} satisfies UploadMeta));

  beginPendingUpload();
  uploadImage(file).then(
    url => {
      const placeholderPos = findPlaceholderPos(view.state, id);
      const tr = view.state.tr.setMeta(uploadKey, {remove: {id}} satisfies UploadMeta);
      const imageType = view.state.schema.nodes.image;
      if (placeholderPos !== null && imageType) {
        tr.insert(placeholderPos, imageType.create({src: url}));
      }
      view.dispatch(tr);
      endPendingUpload();
    },
    () => {
      view.dispatch(view.state.tr.setMeta(uploadKey, {remove: {id}} satisfies UploadMeta));
      const message = '图片上传失败';
      getActiveImageUploadErrorHandler()?.(message);
      onError?.(message);
      endPendingUpload();
    }
  );
}

function findPlaceholderPos(state: EditorState, id: string): number | null {
  const decorations = uploadKey.getState(state);
  const found = decorations?.find(undefined, undefined, spec => spec.id === id);
  return found?.[0]?.from ?? null;
}
