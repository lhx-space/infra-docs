import {existsSync} from 'node:fs';
import {readFile, rm, writeFile} from 'node:fs/promises';
import {extname, join, resolve} from 'node:path';
import {electronApp, is, optimizer} from '@electron-toolkit/utils';
import {app, BrowserWindow, dialog, ipcMain, protocol, safeStorage, shell} from 'electron';
import icon from '../../resources/icon.png?asset';

// 自定义协议必须在 app ready 之前注册，且声明为 standard（像 http 一样解析 host/path，
// BrowserRouter 才能正常匹配路径）+ secure（安全上下文）+ stream（支持流式响应）。
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'luhanxin-docs-app',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true
    }
  }
]);

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.map': 'application/json',
  '.wasm': 'application/wasm',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm'
};

const SCHEME = 'luhanxin-docs-app';
const TOKEN_FILE = 'session-token';
/** 深链 url（窗口尚未就绪时先存这里，did-finish-load 后补发给 renderer） */
let pendingDeepLink: string | null = null;

/**
 * 把 `luhanxin-docs-app://app/xxx` 映射到 out/renderer 下的静态文件。
 * 带文件扩展名的是静态资源；否则是前端路由（/home、/wiki/x），回退到 index.html 交给
 * React Router 处理（SPA history fallback）。
 */
function registerCustomProtocol(): void {
  const rendererRoot = join(__dirname, '../renderer');
  protocol.handle(SCHEME, async request => {
    const url = new URL(request.url);
    const pathname = decodeURIComponent(url.pathname);
    const relative = pathname.replace(/^\/+/, '');
    let filePath = join(rendererRoot, relative);

    const isAsset = extname(relative) !== '';
    if (!isAsset || !existsSync(filePath)) {
      filePath = join(rendererRoot, 'index.html');
    }

    const data = await readFile(filePath);
    const mime = MIME_TYPES[extname(filePath)] ?? 'application/octet-stream';
    return new Response(data, {headers: {'Content-Type': mime}});
  });
}

/** token 用系统钥匙串（safeStorage）加密后落盘到 userData 目录 */
function tokenFilePath(): string {
  return join(app.getPath('userData'), TOKEN_FILE);
}

/** 桌面原生能力对应的 IPC handler，供 preload 的 window.bridge 调用 */
function registerIpcHandlers(): void {
  ipcMain.handle('desktop:open-external', async (_event, url: string) => {
    if (typeof url === 'string' && /^https?:\/\//.test(url)) {
      await shell.openExternal(url);
    }
  });

  ipcMain.handle(
    'desktop:save-file',
    async (_event, options: {defaultPath: string; content: Uint8Array}) => {
      const {canceled, filePath} = await dialog.showSaveDialog({defaultPath: options.defaultPath});
      if (canceled || !filePath) return {canceled: true};
      await writeFile(filePath, Buffer.from(options.content));
      return {canceled: false, filePath};
    }
  );

  ipcMain.handle('desktop:get-stored-token', async () => {
    if (!safeStorage.isEncryptionAvailable()) return null;
    const file = tokenFilePath();
    if (!existsSync(file)) return null;
    try {
      return safeStorage.decryptString(await readFile(file));
    } catch {
      return null;
    }
  });

  ipcMain.handle('desktop:set-stored-token', async (_event, token: string) => {
    if (!safeStorage.isEncryptionAvailable()) return;
    await writeFile(tokenFilePath(), safeStorage.encryptString(token));
  });

  ipcMain.handle('desktop:clear-stored-token', async () => {
    await rm(tokenFilePath(), {force: true});
  });
}

/** 深链：把 luhanxin-docs-app://... 转发给 renderer，由前端路由跳转 */
function sendDeepLink(url: string): void {
  const win = BrowserWindow.getAllWindows()[0];
  if (win) {
    win.webContents.send('desktop:deep-link', url);
  } else {
    pendingDeepLink = url;
  }
}

function extractDeepLink(argv: string[]): string | null {
  return argv.find(arg => arg.startsWith(`${SCHEME}://`)) ?? null;
}

function registerDeepLinks(): void {
  // macOS：应用已运行或被 URL 拉起时走 open-url
  app.on('open-url', (event, url) => {
    event.preventDefault();
    sendDeepLink(url);
  });

  // Windows/Linux：单实例，第二个实例把 URL 通过 argv 传给第一个
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    app.quit();
    return;
  }
  app.on('second-instance', (_event, argv) => {
    const url = extractDeepLink(argv);
    if (url) sendDeepLink(url);
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  // 注册为协议默认处理程序；dev 下 electron 的 executable 不是我们的 app，需要显式传路径
  if (process.defaultApp && process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(SCHEME, process.execPath, [resolve(process.argv[1])]);
  } else {
    app.setAsDefaultProtocolClient(SCHEME);
  }
}

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    title: 'Yjs Docs',
    ...(process.platform === 'linux' ? {icon} : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  });

  mainWindow.on('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.webContents.setWindowOpenHandler(details => {
    shell.openExternal(details.url);
    return {action: 'deny'};
  });

  // 窗口就绪后补发启动时收到的深链
  mainWindow.webContents.on('did-finish-load', () => {
    if (pendingDeepLink) {
      mainWindow.webContents.send('desktop:deep-link', pendingDeepLink);
      pendingDeepLink = null;
    }
  });

  // HMR for renderer base on electron-vite cli.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    // 生产/预览：用自定义协议加载（而非 file://），这样 BrowserRouter 能正常工作、
    // Origin 是干净的 luhanxin-docs-app://app（配合 apps/api 的 CORS 白名单）。
    mainWindow.loadURL(`${SCHEME}://app/index.html`);
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.lhxspace.infra-docs');

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  registerCustomProtocol();
  registerIpcHandlers();
  registerDeepLinks();

  // 启动时通过 URL 拉起（Windows/Linux 的 argv 携带）
  pendingDeepLink = extractDeepLink(process.argv);

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
