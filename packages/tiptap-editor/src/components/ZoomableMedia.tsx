import type {MouseEvent as ReactMouseEvent, ReactNode, TouchEvent as ReactTouchEvent} from 'react';
import {type PointerEvent as ReactPointerEvent, useEffect, useRef, useState} from 'react';

const MIN_SCALE = 1;
const MAX_SCALE = 4;

function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

function distanceBetween(
  a: {clientX: number; clientY: number},
  b: {clientX: number; clientY: number}
): number {
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

interface ZoomableMediaProps {
  children: ReactNode;
  className?: string;
}

/**
 * 图片/Mermaid 全屏预览遮罩里共用的"手势缩放"容器：滚轮缩放、拖拽平移（桌面），
 * 双指缩放、单指平移（触屏），双击在 1x/2x 之间切换（见 document-editor spec.md
 * 「图片/图表预览支持手势缩放」）。
 *
 * ## 事件冒泡
 * 外层遮罩自己挂了"点击空白处关闭预览"的 `onClick`（见 `DocumentEditor.tsx`/
 * `MermaidView.tsx`），如果这里的手势事件冒泡出去，缩放/拖拽松手的一瞬间就会被误判成
 * "点击背景"，预览窗口跟着被关掉。所以内部所有手势相关的事件处理函数都显式
 * `stopPropagation`，只有真正点在这个容器**外面**（遮罩背景）的点击才会传到外层触发关闭。
 *
 * ## 为什么滚轮/触屏缩放要单独挂原生监听器，不能直接用 React 的 `onWheel`/`onTouchMove`
 * React 从 v17 起，`onWheel` 和 `onTouchMove`（`onTouchStart`/`onTouchEnd` 不受影响）这两个
 * 合成事件默认是 **passive** 的——跟浏览器自己的默认策略保持一致，为了不阻塞滚动/缩放的
 * 渲染性能。passive 监听器里调用 `event.preventDefault()` 完全不起作用，浏览器只会在
 * 控制台打一条 "Unable to preventDefault inside passive event listener invocation" 警告，
 * 该干什么还干什么（页面照样被滚轮滚动、触屏照样触发浏览器原生的整页缩放），我们自己的
 * 缩放逻辑虽然状态更新了，但视觉上会跟浏览器的原生滚动/缩放"打架"。
 * 解决办法是绕开 React 的合成事件系统，用 `element.addEventListener('wheel'/'touchmove',
 * handler, {passive: false})` 手动挂原生监听器——`{passive: false}` 显式声明"我要调用
 * preventDefault"，`preventDefault()` 才会真正生效。
 */
export function ZoomableMedia({children, className}: ZoomableMediaProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({x: 0, y: 0});

  // 原生事件监听器（下面的 effect）只在挂载时挂一次，不能直接读闭包里的 `scale`/`offset`
  // state（会一直拿到挂载那一刻的旧值）——用 ref 镜像最新值，原生监听器读 ref，更新还是
  // 走 `setScale`/`setOffset` 触发正常的 React 渲染
  const scaleRef = useRef(scale);
  const offsetRef = useRef(offset);
  useEffect(() => {
    scaleRef.current = scale;
  }, [scale]);
  useEffect(() => {
    offsetRef.current = offset;
  }, [offset]);

  const dragRef = useRef<{startX: number; startY: number; originX: number; originY: number} | null>(
    null
  );
  const pinchRef = useRef<{initialDistance: number; initialScale: number} | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    function handleWheelNative(event: WheelEvent): void {
      event.preventDefault();
      event.stopPropagation();
      const next = clampScale(scaleRef.current - event.deltaY * 0.0015);
      setScale(next);
      if (next === 1) setOffset({x: 0, y: 0});
    }

    function handleTouchMoveNative(event: TouchEvent): void {
      event.stopPropagation();
      if (event.touches.length === 2 && pinchRef.current) {
        event.preventDefault();
        const [a, b] = [event.touches[0], event.touches[1]];
        if (!a || !b) return;
        const ratio = distanceBetween(a, b) / pinchRef.current.initialDistance;
        const next = clampScale(pinchRef.current.initialScale * ratio);
        setScale(next);
        if (next === 1) setOffset({x: 0, y: 0});
      } else if (event.touches.length === 1 && dragRef.current) {
        event.preventDefault();
        const touch = event.touches[0];
        if (!touch) return;
        setOffset({
          x: dragRef.current.originX + (touch.clientX - dragRef.current.startX),
          y: dragRef.current.originY + (touch.clientY - dragRef.current.startY)
        });
      }
    }

    el.addEventListener('wheel', handleWheelNative, {passive: false});
    el.addEventListener('touchmove', handleTouchMoveNative, {passive: false});
    return () => {
      el.removeEventListener('wheel', handleWheelNative);
      el.removeEventListener('touchmove', handleTouchMoveNative);
    };
  }, []);

  function handleDoubleClick(event: ReactPointerEvent<HTMLDivElement>): void {
    event.stopPropagation();
    setScale(prev => (prev > 1 ? 1 : 2));
    setOffset({x: 0, y: 0});
  }

  function handleClick(event: ReactMouseEvent<HTMLDivElement>): void {
    // 不做任何事，只是拦住冒泡——纯点击（没有拖动）不切换缩放，也不该关闭预览，
    // 缩放交给双击/滚轮，平移交给拖拽
    event.stopPropagation();
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>): void {
    event.stopPropagation();
    if (scale <= 1) return;
    dragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      originX: offset.x,
      originY: offset.y
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>): void {
    if (!dragRef.current) return;
    event.stopPropagation();
    setOffset({
      x: dragRef.current.originX + (event.clientX - dragRef.current.startX),
      y: dragRef.current.originY + (event.clientY - dragRef.current.startY)
    });
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLDivElement>): void {
    event.stopPropagation();
    dragRef.current = null;
  }

  function handleTouchStart(event: ReactTouchEvent<HTMLDivElement>): void {
    event.stopPropagation();
    if (event.touches.length === 2) {
      const [a, b] = [event.touches[0], event.touches[1]];
      if (a && b) pinchRef.current = {initialDistance: distanceBetween(a, b), initialScale: scale};
    } else if (event.touches.length === 1 && scale > 1) {
      const touch = event.touches[0];
      if (touch) {
        dragRef.current = {
          startX: touch.clientX,
          startY: touch.clientY,
          originX: offset.x,
          originY: offset.y
        };
      }
    }
  }

  function handleTouchEnd(event: ReactTouchEvent<HTMLDivElement>): void {
    event.stopPropagation();
    pinchRef.current = null;
    dragRef.current = null;
  }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: 纯手势容器（滚轮/拖拽/触屏缩放），预览本身已经有 Esc 键关闭
    // biome-ignore lint/a11y/useKeyWithClickEvents: 缩放/平移是鼠标和触屏手势，没有对应的键盘操作范式，Esc 关闭已经覆盖键盘可达性
    <div
      ref={containerRef}
      className={['doc-editor-zoomable', className].filter(Boolean).join(' ')}
      style={{
        transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
        cursor: scale > 1 ? 'grab' : 'zoom-in'
      }}
      onDoubleClick={handleDoubleClick}
      onClick={handleClick}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {children}
    </div>
  );
}
