const { app, BrowserWindow, dialog } = require('electron');
const path = require('path');
const http = require('http');
const { pathToFileURL } = require('url');

let win = null;

async function startServer() {
  const backendPath = path.join(app.getAppPath(), 'backend', 'server.js');
  await import(pathToFileURL(backendPath).href);
}

function waitForBackend(retries = 40, interval = 1000) {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const check = () => {
      http
        .get('http://localhost:3001/health', (res) => {
          if (res.statusCode === 200) return resolve();
          else retry();
        })
        .on('error', retry);
    };
    const retry = () => {
      if (++attempts >= retries) return reject(new Error('El servidor no respondió en 40s'));
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
  try {
    await startServer();
    await waitForBackend();
    createWindow();
  } catch (err) {
    dialog.showErrorBox('Error al iniciar', `SendWave no pudo arrancar.\n\n${err.message}`);
    app.quit();
  }
});

app.on('window-all-closed', () => app.quit());
app.on('activate', () => { if (!win) createWindow(); });
