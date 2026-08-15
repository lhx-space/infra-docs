/**
 * `CollaborationCaret` 扩展要求的默认光标/选区 DOM 渲染函数（见其 options.render/
 * selectionRender），跟编辑器自身的 CSS 变量体系保持一致（见 styles/collaboration.css）。
 * 消费方不需要关心这两个函数的存在，`DocumentEditor` 内部直接用它们作为默认实现。
 *
 * `CollaborationCaret` 的类型声明里 `user` 参数是宽松的 `Record<string, any>`
 * （允许消费方塞任意自定义字段），这里按需读取 `name`/`color` 两个字段并给出兜底值，
 * 不直接断言成 `CollaborationUser`——避免遇到字段缺失时把 `undefined` 硬塞进 DOM
 * 属性（`borderColor`/`textContent` 等），比强制类型断言更安全。
 *
 * 注意：这里只渲染光标竖线本身，不再把用户名标签渲染成它的子节点——原来的写法会被
 * `content-visibility: auto` 的绘制局限裁掉一部分（见
 * hooks/use-collaboration-caret-labels.ts 顶部的详细说明），用户名标签改由那个 hook +
 * `DocumentEditor` 里的独立覆盖层渲染。这里通过 `data-collab-caret-*` 两个属性把
 * name/color 挂在光标元素上，供那个 hook 读取。
 */
import type {DecorationAttrs} from '@tiptap/pm/view';

function readUser(user: Record<string, unknown>): {name: string; color: string} {
  return {
    name: typeof user['name'] === 'string' ? user['name'] : '匿名用户',
    color: typeof user['color'] === 'string' ? user['color'] : '#999999'
  };
}

export function renderCaret(user: Record<string, unknown>): HTMLElement {
  const {name, color} = readUser(user);
  const cursor = document.createElement('span');
  cursor.classList.add('doc-editor-caret');
  cursor.style.borderColor = color;
  cursor.dataset['collabCaretName'] = name;
  cursor.dataset['collabCaretColor'] = color;
  return cursor;
}

export function renderCaretSelection(user: Record<string, unknown>): DecorationAttrs {
  const {color} = readUser(user);
  return {
    style: `background-color: ${color}33`,
    class: 'doc-editor-caret-selection'
  };
}
