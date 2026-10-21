const { app, BrowserWindow, Menu, dialog, ipcMain } = require('electron');
const path = require('path');
const http = require('http');
const net = require('net');
const { fork } = require('child_process');
const fs = require('fs');

let mainWindow = null;
let serverProcess = null;
let serverPort = null;

// Find an available port on 127.0.0.1
function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close((err) => {
        if (err) reject(err);
        else resolve(port);
      });
    });
  });
}

// Check if an HTTP server is currently responding on a given port
function pingServer(port) {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}/api/files`, (res) => {
      resolve(res.statusCode < 500);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(500, () => {
      req.destroy();
      resolve(false);
    });
  });
}

// Poll until the server responds or times out
function waitForServer(port, timeoutMs = 20000) {
  const startTime = Date.now();
  return new Promise((resolve, reject) => {
    const check = async () => {
      const ok = await pingServer(port);
      if (ok) {
        return resolve();
      }
      if (Date.now() - startTime > timeoutMs) {
        return reject(new Error(`Next.js server failed to respond on port ${port} within ${timeoutMs}ms`));
      }
      setTimeout(check, 150);
    };
    check();
  });
}

// Locate the standalone Next.js server entry file
function resolveServerPath() {
  // 1. In packaged Electron app: extraResources copies to <resourcesPath>/standalone/server.js
  if (app.isPackaged) {
    const packagedPath = path.join(process.resourcesPath, 'standalone', 'server.js');
    if (fs.existsSync(packagedPath)) return packagedPath;
  }

  // 2. Local standalone build (after npm run build + prepare)
  const localStandalone = path.join(__dirname, '..', '.next', 'standalone', 'server.js');
  if (fs.existsSync(localStandalone)) return localStandalone;

  // 3. Fallback to repository root server.js
  const devServer = path.join(__dirname, '..', 'server.js');
  if (fs.existsSync(devServer)) return devServer;

  throw new Error('Could not locate Next.js server entry script.');
}

async function startServer() {
  // In dev mode, check if a dev server is already running on port 3000
  if (!app.isPackaged) {
    const devPort = parseInt(process.env.PORT || '3000', 10);
    const isRunning = await pingServer(devPort);
    if (isRunning) {
      serverPort = devPort;
      return devPort;
    }
  }

  serverPort = await getFreePort();
  const serverPath = resolveServerPath();
  const serverDir = path.dirname(serverPath);

  // Parse any directory argument passed on the CLI
  const customDir = process.argv.slice(app.isPackaged ? 1 : 2).find((arg) => !arg.startsWith('-') && fs.existsSync(arg));

  const env = {
    ...process.env,
    PORT: String(serverPort),
    HOSTNAME: '127.0.0.1',
    NODE_ENV: app.isPackaged ? 'production' : (process.env.NODE_ENV || 'production'),
    ELECTRON_RUN_AS_NODE: '1',
  };

  if (customDir) {
    env.DIAGRAMS_DIR = path.resolve(customDir);
  }

  serverProcess = fork(serverPath, [], {
    cwd: serverDir,
    env,
    stdio: 'inherit',
  });

  serverProcess.on('error', (err) => {
    console.error('[Electron Main] Server process error:', err);
  });

  serverProcess.on('exit', (code, signal) => {
    if (code !== 0 && code !== null) {
      console.error(`[Electron Main] Server process exited with code ${code} (signal: ${signal})`);
    }
  });

  await waitForServer(serverPort);
  return serverPort;
}

function stopServer() {
  if (serverProcess) {
    try {
      serverProcess.kill('SIGTERM');
    } catch {
      // ignore
    }
    serverProcess = null;
  }
}

async function openDirectoryDialog() {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Select Diagrams Directory',
  });
  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }
  const chosenDir = result.filePaths[0];
  if (serverPort) {
    mainWindow.loadURL(`http://127.0.0.1:${serverPort}/?dir=${encodeURIComponent(chosenDir)}`);
  }
  return chosenDir;
}

function buildMenu() {
  const isMac = process.platform === 'darwin';

  const template = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' },
            ],
          },
        ]
      : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'Open Directory...',
          accelerator: 'CmdOrCtrl+O',
          click: () => openDirectoryDialog(),
        },
        {
          label: 'Open Default Diagrams',
          click: () => {
            if (mainWindow && serverPort) {
              mainWindow.loadURL(`http://127.0.0.1:${serverPort}`);
            }
          },
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(isMac
          ? [{ type: 'separator' }, { role: 'front' }, { type: 'separator' }, { role: 'window' }]
          : [{ role: 'close' }]),
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

function createMainWindow(port) {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0f172a',
    title: 'Mermaid Sequence & Flowchart Viewer',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  mainWindow.loadURL(`http://127.0.0.1:${port}`);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// IPC handler for dialog triggered from frontend
ipcMain.handle('dialog:openDirectory', async () => {
  return await openDirectoryDialog();
});

app.whenReady().then(async () => {
  buildMenu();
  try {
    const port = await startServer();
    createMainWindow(port);
  } catch (err) {
    console.error('[Electron Main] Fatal error starting app:', err);
    dialog.showErrorBox('Failed to launch server', err.message || String(err));
    app.quit();
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0 && serverPort) {
      createMainWindow(serverPort);
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => {
  stopServer();
});
