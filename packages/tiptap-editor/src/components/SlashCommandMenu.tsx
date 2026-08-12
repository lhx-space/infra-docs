import {forwardRef, useEffect, useImperativeHandle, useState} from 'react';
import type {SlashCommandItem} from '../utils/slash-command';

export interface SlashCommandMenuHandle {
  /** 由 `utils/slash-command.ts` 的 Suggestion `onKeyDown` 转发键盘事件（见 spec.md「继续输入过滤菜单项」，
   * 上下选择/回车确认/Esc 关闭在这里统一处理） */
  onKeyDown: (event: KeyboardEvent) => boolean;
}

interface SlashCommandMenuProps {
  items: SlashCommandItem[];
  onSelect: (item: SlashCommandItem) => void;
}

/** `/` 触发的插入菜单 UI：键盘上下选择、回车确认、鼠标点击选中（见 document-editor spec.md「斜杠命令插入菜单」） */
export const SlashCommandMenu = forwardRef<SlashCommandMenuHandle, SlashCommandMenuProps>(
  function SlashCommandMenu({items, onSelect}, ref) {
    const [selectedIndex, setSelectedIndex] = useState(0);

    // items 引用变化（用户继续输入过滤出新的候选列表）时把选中项重置回第一项——这个依赖
    // 是有意的，Biome 把它误判成"未在函数体里被读取所以多余"，但这里本来就只需要"订阅
    // 变化"这个事实本身，不需要读取 items 的值
    // biome-ignore lint/correctness/useExhaustiveDependencies: items 是有意的信号依赖，见上面注释
    useEffect(() => {
      setSelectedIndex(0);
    }, [items]);

    useImperativeHandle(ref, () => ({
      onKeyDown(event) {
        if (items.length === 0) return false;
        if (event.key === 'ArrowDown') {
          setSelectedIndex(index => (index + 1) % items.length);
          return true;
        }
        if (event.key === 'ArrowUp') {
          setSelectedIndex(index => (index - 1 + items.length) % items.length);
          return true;
        }
        if (event.key === 'Enter') {
          const item = items[selectedIndex];
          if (item) onSelect(item);
          return true;
        }
        return false;
      }
    }));

    if (items.length === 0) {
      return (
        <div className="doc-editor-slash-menu doc-editor-slash-menu--empty">没有匹配的命令</div>
      );
    }

    return (
      <div className="doc-editor-slash-menu" role="listbox">
        {items.map((item, index) => (
          <button
            key={item.title}
            type="button"
            role="option"
            aria-selected={index === selectedIndex}
            className="doc-editor-slash-menu__item"
            data-active={index === selectedIndex}
            onMouseEnter={() => setSelectedIndex(index)}
            onClick={() => onSelect(item)}
          >
            <span className="doc-editor-slash-menu__title">{item.title}</span>
            <span className="doc-editor-slash-menu__description">{item.description}</span>
          </button>
        ))}
      </div>
    );
  }
);
