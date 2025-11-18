const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

// Detect if we're in development mode
const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

function createWindow() {
  // Use custom icon if available, otherwise fall back to default
  let iconPath = path.join(__dirname, 'build/logo192.png');
  const customIconPath = path.join(__dirname, 'icons/icon.ico');
  if (fs.existsSync(customIconPath)) {
    iconPath = customIconPath;
  }

  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
    icon: iconPath,
  });

  // Load the app
  if (isDev) {
    // In development, load from the React dev server
    win.loadURL('http://localhost:3000');
    win.webContents.openDevTools();
  } else {
    // In production, load from the build folder
    // Use path.join to handle different OS path separators
    const indexPath = path.join(__dirname, 'build', 'index.html');
    win.loadFile(indexPath);
  }
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

