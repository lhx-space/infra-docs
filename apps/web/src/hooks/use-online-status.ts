import {useEffect, useState} from 'react';

/** 断网/恢复网络的响应式状态（见 document-editor spec.md「离线只读缓存」「网络恢复后自动恢复可编辑」） */
export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine);

  useEffect(() => {
    function handleOnline(): void {
      setOnline(true);
    }
    function handleOffline(): void {
      setOnline(false);
    }
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return online;
}
