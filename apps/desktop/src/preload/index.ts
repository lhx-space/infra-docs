import {electronAPI} from '@electron-toolkit/preload';
import type {DesktopBridge} from '@luhanxin/desktop-bridge';
import {contextBridge, ipcRenderer} from 'electron';

// 暴露给 renderer 的原生能力桥（契约见 @luhanxin/desktop-bridge 的 DesktopBridge）。
// 这里只暴露白名单方法，不透出原始 ipcRenderer，renderer 无法调用到未声明的能力。
const bridge: DesktopBridge = {
  openExternal: url => ipcRenderer.invoke('desktop:open-external', url),
  saveFile: options => ipcRenderer.invoke('desktop:save-file', options),
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node
  }
};

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI);
    contextBridge.exposeInMainWorld('bridge', bridge);
  } catch (error) {
    console.error(error);
  }
} else {
  // @ts-expect-error (define in dts)
  window.electron = electronAPI;
  // @ts-expect-error (define in dts)
  window.bridge = bridge;
}
