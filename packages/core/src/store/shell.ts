import {create} from 'zustand';

const COLLAPSED_STORAGE_KEY = 'sidebar-collapsed';
const WIDTH_STORAGE_KEY = 'sidebar-width';

export const SIDEBAR_MIN_WIDTH = 200;
export const SIDEBAR_MAX_WIDTH = 480;
export const SIDEBAR_DEFAULT_WIDTH = 260;

function clampWidth(width: number): number {
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, width));
}

function readStoredCollapsed(): boolean {
  return localStorage.getItem(COLLAPSED_STORAGE_KEY) === '1';
}

function readStoredWidth(): number {
  const stored = Number(localStorage.getItem(WIDTH_STORAGE_KEY));
  return Number.isFinite(stored) && stored >= SIDEBAR_MIN_WIDTH && stored <= SIDEBAR_MAX_WIDTH
    ? stored
    : SIDEBAR_DEFAULT_WIDTH;
}

interface ShellState {
  sidebarCollapsed: boolean;
  sidebarWidth: number;
  toggleSidebar: () => void;
  setSidebarWidth: (width: number) => void;
}

/**
 * AppShell 的 Sidebar UI 状态：折叠（整体隐藏）与宽度（拖拽调整），
 * 持久化到 localStorage，模式与 `store/theme.ts` 一致，刷新后保持用户上次的设置。
 */
export const useShellStore = create<ShellState>(set => ({
  sidebarCollapsed: readStoredCollapsed(),
  sidebarWidth: readStoredWidth(),

  toggleSidebar: () =>
    set(state => {
      const next = !state.sidebarCollapsed;
      localStorage.setItem(COLLAPSED_STORAGE_KEY, next ? '1' : '0');
      return {sidebarCollapsed: next};
    }),

  setSidebarWidth: width => {
    const clamped = clampWidth(width);
    localStorage.setItem(WIDTH_STORAGE_KEY, String(clamped));
    set({sidebarWidth: clamped});
  }
}));
