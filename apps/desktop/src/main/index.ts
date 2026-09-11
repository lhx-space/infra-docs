import {existsSync} from 'node:fs';
import {readFile, writeFile} from 'node:fs/promises';
import {extname, join} from 'node:path';
import {electronApp, is, optimizer} from '@electron-toolkit/utils';
import {app, BrowserWindow, dialog, ipcMain, protocol, shell} from 'electron';
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

/**
 * 把 `luhanxin-docs-app://app/xxx` 映射到 out/renderer 下的静态文件。
 * 带文件扩展名的是静态资源；否则是前端路由（/home、/wiki/x），回退到 index.html 交给
 * React Router 处理（SPA history fallback）。
 */
function registerCustomProtocol(): void {
  const rendererRoot = join(__dirname, '../renderer');
  protocol.handle('luhanxin-docs-app', async request => {
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

/** 桌面原生能力对应的 IPC handler，供 preload 的 window.bridge 调用 */
function registerIpcHandlers(): void {
  ipcMain.handle('desktop:open-external', async (_event, url: string) => {
    if (typeof url === 'string' && /^https?:\/\//.test(url)) {
      await shell.openExternal(url);
    }
  });

  ipcMain.handle(
    'desktop:save-file',
    async (_event, options: {defaultPath: string; content: string}) => {
      const {canceled, filePath} = await dialog.showSaveDialog({defaultPath: options.defaultPath});
      if (canceled || !filePath) return {canceled: true};
      await writeFile(filePath, options.content, 'utf8');
      return {canceled: false, filePath};
    }
  );
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

  // HMR for renderer base on electron-vite cli.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    // 生产/预览：用自定义协议加载（而非 file://），这样 BrowserRouter 能正常工作、
    // Origin 是干净的 luhanxin-docs-app://app（配合 apps/api 的 CORS 白名单）。
    mainWindow.loadURL('luhanxin-docs-app://app/index.html');
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.lhxspace.infra-docs');

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  registerCustomProtocol();
  registerIpcHandlers();

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
