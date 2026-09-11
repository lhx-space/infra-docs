import {useEffect, useRef, useState} from 'react';

interface UseResizableOptions {
  /** 当前宽度，用作每次拖拽起点的基准值 */
  width: number;
  /** 拖拽过程中实时回调新宽度；钳制（最小/最大宽度）交给调用方自己在这里做，本 hook 不关心业务边界 */
  onResize: (width: number) => void;
}

interface UseResizableResult {
  /** 是否正在拖拽中，供调用方需要时展示拖拽态样式 */
  isDragging: boolean;
  /** 绑定到可拖拽边缘的 onMouseDown */
  handleResizeStart: (event: React.MouseEvent) => void;
}

/**
 * 通用的"鼠标拖拽调整宽度"交互逻辑：跟"侧边栏"这类具体业务身份无关，
 * 任何"可拖拽调宽的面板"都能复用——这是一段行为（绑定 DOM 事件、维护拖拽起点），
 * 不是数据，所以抽成 hook 而不是变成 props。
 *
 * 从 `components/shell/Sidebar.tsx` 抽出，原地保留的只是"钳制到 200-480px"这类
 * 业务边界（在 `store/shell.ts` 的 `setSidebarWidth` 里做），hook 本身不关心。
 */
export function useResizable({width, onResize}: UseResizableOptions): UseResizableResult {
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef({x: 0, width});

  useEffect(() => {
    if (!isDragging) return;

    function handleMouseMove(event: MouseEvent) {
      const delta = event.clientX - dragStartRef.current.x;
      onResize(dragStartRef.current.width + delta);
    }

    function handleMouseUp() {
      setIsDragging(false);
    }

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, onResize]);

  function handleResizeStart(event: React.MouseEvent): void {
    event.preventDefault();
    dragStartRef.current = {x: event.clientX, width};
    setIsDragging(true);
  }

  return {isDragging, handleResizeStart};
}
