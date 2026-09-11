import type {ElectronAPI} from '@electron-toolkit/preload';
import type {DesktopBridge} from '@luhanxin/desktop-bridge';

declare global {
  interface Window {
    electron: ElectronAPI;
    bridge: DesktopBridge;
  }
}
