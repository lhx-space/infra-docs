export interface LinkPasteChooserHandle {
  onKeyDown: (event: KeyboardEvent) => boolean;
}

interface LinkPasteChooserProps {
  url: string;
  onChoose: (choice: 'plain' | 'card') => void;
}

/**
 * 粘贴一个 URL 后弹出的"显示为纯链接 / 显示为预览卡片"选择提示
 * （见 link-preview spec.md「粘贴链接后可选择展示形式」）。
 */
export function LinkPasteChooser({url, onChoose}: LinkPasteChooserProps) {
  return (
    <div className="doc-editor-link-chooser" role="dialog">
      <p className="doc-editor-link-chooser__url">{url}</p>
      <div className="doc-editor-link-chooser__actions">
        <button type="button" onClick={() => onChoose('plain')}>
          显示为纯链接
        </button>
        <button type="button" onClick={() => onChoose('card')}>
          显示为预览卡片
        </button>
      </div>
    </div>
  );
}
