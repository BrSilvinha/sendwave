const { app, BrowserWindow, dialog } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const http = require('http');

let win = null;
let backendProcess = null;

function startBackend() {
  const backendPath = path.join(__dirname, '..', 'backend');
  backendProcess = spawn('node', ['server.js'], {
    cwd: backendPath,
    stdio: 'inherit',
    env: { ...process.env, PORT: '3001' },
  });

  backendProcess.on('error', (err) => {
    dialog.showErrorBox('Error de backend', `No se pudo iniciar el servidor: ${err.message}`);
  });
}

function waitForBackend(url, retries = 30, interval = 1000) {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const check = () => {
      http.get(url, (res) => {
        if (res.statusCode === 200) return resolve();
        retry();
      }).on('error', retry);
    };
    const retry = () => {
      if (++attempts >= retries) return reject(new Error('Backend no respondió a tiempo'));
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
    await waitForBackend('http://localhost:3001/health');
    createWindow();
  } catch {
    dialog.showErrorBox('Error', 'El servidor no pudo iniciar. Reinicia la aplicación.');
    app.quit();
  }
});

app.on('window-all-closed', () => {
  if (backendProcess) backendProcess.kill();
  app.quit();
});

app.on('activate', () => {
  if (win === null) createWindow();
});
