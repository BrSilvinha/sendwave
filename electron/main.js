const { app, BrowserWindow, dialog, utilityProcess } = require('electron');
const path = require('path');
const http = require('http');

let win = null;
let backend = null;

function backendScript() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'backend', 'server.js')
    : path.join(__dirname, '..', 'backend', 'server.js');
}

function backendCwd() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'backend')
    : path.join(__dirname, '..', 'backend');
}

function frontendOutDir() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'frontend', 'out')
    : path.join(__dirname, '..', 'frontend', 'out');
}

function startBackend() {
  const userData = app.getPath('userData');

  backend = utilityProcess.fork(backendScript(), [], {
    stdio: 'pipe',
    cwd: backendCwd(),
    env: {
      ...process.env,
      PORT: '3001',
      WA_AUTH_PATH: userData,
      FRONTEND_OUT: frontendOutDir(),
    },
  });

  backend.stdout?.on('data', (d) => process.stdout.write(d));
  backend.stderr?.on('data', (d) => process.stderr.write(d));

  backend.on('exit', (code) => {
    if (code !== 0 && win) {
      dialog.showErrorBox(
        'Error inesperado',
        `El servidor se cerró (código ${code}). Reinicia SendWave.`
      );
    }
  });
}

function waitForBackend(retries = 40, interval = 1000) {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const check = () => {
      http
        .get('http://localhost:3001/health', (res) => {
          if (res.statusCode === 200) return resolve();
          retry();
        })
        .on('error', retry);
    };
    const retry = () => {
      if (++attempts >= retries) return reject(new Error('El servidor no respondió'));
      setTimeout(check, interval);
    };
    check();
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1100,
    height: 750,
    minWidth: 800,
    minHeight: 600,
    title: 'SendWave',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  win.loadURL('http://localhost:3001');
  win.setMenuBarVisibility(false);
  win.on('closed', () => { win = null; });
}

app.whenReady().then(async () => {
  startBackend();
  try {
    await waitForBackend();
    createWindow();
  } catch {
    dialog.showErrorBox('Error al iniciar', 'SendWave no pudo arrancar. Reinicia la aplicación.');
    app.quit();
  }
});

app.on('window-all-closed', () => {
  if (backend) backend.kill();
  app.quit();
});

app.on('activate', () => {
  if (!win) createWindow();
});
