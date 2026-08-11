import {create} from 'zustand';

export type ThemePreference = 'light' | 'dark' | 'system';
type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'theme';

function getSystemTheme(): ResolvedTheme {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function resolveTheme(preference: ThemePreference): ResolvedTheme {
  return preference === 'system' ? getSystemTheme() : preference;
}

function applyTheme(resolved: ResolvedTheme): void {
  document.documentElement.classList.toggle('dark', resolved === 'dark');
}

function readStoredPreference(): ThemePreference {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'system';
}

interface ThemeState {
  theme: ThemePreference;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: ThemePreference) => void;
}

/**
 * 主题状态管理：light/dark/system 三态，持久化到 localStorage，
 * 实际生效通过给 <html> 切换 .dark class（配合 globals.css 的 @custom-variant dark）。
 * index.html 中的内联脚本会在 React 加载前提前设置好 class，避免首屏闪烁。
 */
export const useThemeStore = create<ThemeState>(set => {
  const theme = readStoredPreference();
  const resolvedTheme = resolveTheme(theme);
  applyTheme(resolvedTheme);

  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (useThemeStore.getState().theme !== 'system') return;
    const nextResolved = getSystemTheme();
    applyTheme(nextResolved);
    set({resolvedTheme: nextResolved});
  });

  return {
    theme,
    resolvedTheme,
    setTheme: nextTheme => {
      localStorage.setItem(STORAGE_KEY, nextTheme);
      const nextResolved = resolveTheme(nextTheme);
      applyTheme(nextResolved);
      set({theme: nextTheme, resolvedTheme: nextResolved});
    }
  };
});
