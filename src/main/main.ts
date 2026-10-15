import { app, BrowserWindow, shell } from 'electron';
import path from 'path';
import fs from 'fs';
import { setupIpcHandlers } from './ipc';

const logFile = path.join(app.getPath('userData'), 'desk_klean_debug.log');
const rootLogFile = 'E:\\Coding\\antigravity-projects\\DeskKlean\\debug.log';

function debugLog(msg: string) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try {
    fs.appendFileSync(rootLogFile, line);
  } catch (e) {}
  try {
    fs.appendFileSync(logFile, line);
  } catch (e) {}
}

// Prevent EPIPE crashes when standard output/error streams are disconnected in Windows GUI mode
if (process.stdout && typeof (process.stdout as any).on === 'function') {
  (process.stdout as any).on('error', (err: any) => {
    if (err?.code === 'EPIPE') return;
  });
}
if (process.stderr && typeof (process.stderr as any).on === 'function') {
  (process.stderr as any).on('error', (err: any) => {
    if (err?.code === 'EPIPE') return;
  });
}

process.on('uncaughtException', (err: any) => {
  if (err?.code === 'EPIPE') return;
  debugLog('CRASH uncaughtException: ' + (err?.stack || err));
});

process.on('unhandledRejection', (reason: any) => {
  debugLog('CRASH unhandledRejection: ' + (reason?.stack || reason));
});

debugLog(`main.ts started. PID=${process.pid}, isPackaged=${app.isPackaged}, argv=${process.argv.join(' ')}`);

let mainWindow: BrowserWindow | null = null;

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

function createWindow(): void {
  debugLog('createWindow called');
  mainWindow = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 1024,
    minHeight: 680,
    frame: false, // Frameless custom sleek dark window
    backgroundColor: '#0B0F17',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // Setup all IPC operations
  try {
    setupIpcHandlers(mainWindow);
    debugLog('setupIpcHandlers completed successfully');
  } catch (e: any) {
    debugLog('setupIpcHandlers error: ' + (e?.stack || e));
  }

  let windowShown = false;
  const showWindowSafely = () => {
    if (windowShown || !mainWindow) return;
    windowShown = true;
    debugLog('showWindowSafely called, calling mainWindow.show()');
    mainWindow.show();
    mainWindow.focus();
    if (isDev) {
      mainWindow.webContents.openDevTools({ mode: 'detach' });
    }
  };

  mainWindow.once('ready-to-show', () => {
    debugLog('ready-to-show fired');
    showWindowSafely();
  });

  // Fallback to guarantee window is visible if ready-to-show is delayed
  setTimeout(() => {
    if (mainWindow && !mainWindow.isVisible()) {
      debugLog('Fallback showing mainWindow after timeout');
      showWindowSafely();
    }
  }, 2000);

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
    debugLog(`did-fail-load: code=${errorCode}, desc=${errorDescription}`);
  });

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    debugLog('render-process-gone: ' + JSON.stringify(details));
  });

  mainWindow.webContents.on('console-message', (_event, _level, message, line, sourceId) => {
    debugLog(`renderer-console: ${message} (${sourceId}:${line})`);
  });

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: 'deny' };
  });

  if (isDev) {
    const devServerUrl = process.env['VITE_DEV_SERVER_URL'] || 'http://localhost:5173';
    debugLog('Dev mode: connecting to ' + devServerUrl);
    const loadDevServer = () => {
      mainWindow?.loadURL(devServerUrl).catch(() => {
        setTimeout(loadDevServer, 500);
      });
    };
    loadDevServer();
  } else {
    const rendererDist = path.join(__dirname, '../renderer/index.html');
    debugLog('Prod mode: loading file ' + rendererDist + ' (exists: ' + fs.existsSync(rendererDist) + ')');
    mainWindow.loadFile(rendererDist).catch((err) => {
      debugLog('loadFile error: ' + err);
    });
  }

  mainWindow.on('closed', () => {
    debugLog('mainWindow closed');
    mainWindow = null;
  });
}

// Ensure single instance with grace retry period for yielding process during elevation
let gotTheLock = app.requestSingleInstanceLock();
debugLog('app.requestSingleInstanceLock() initial result: ' + gotTheLock);

if (!gotTheLock) {
  debugLog('Single instance lock not acquired initially. Retrying for up to 2s to allow yielding process to release...');
  const retryStart = Date.now();
  while (!gotTheLock && Date.now() - retryStart < 2000) {
    const end = Date.now() + 150;
    while (Date.now() < end) {}
    gotTheLock = app.requestSingleInstanceLock();
    debugLog('app.requestSingleInstanceLock() retry result: ' + gotTheLock);
  }
}

if (!gotTheLock) {
  debugLog('Could not get single instance lock after retries! Quitting.');
  app.quit();
} else {
  app.on('second-instance', () => {
    debugLog('second-instance event received');
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    } else {
      createWindow();
    }
  });

  app.whenReady().then(() => {
    debugLog('app.whenReady resolved');
    createWindow();

    app.on('activate', () => {
      debugLog('app activate event');
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  });
}

app.on('window-all-closed', () => {
  debugLog('app window-all-closed event');
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => {
  debugLog('app will-quit event');
});


