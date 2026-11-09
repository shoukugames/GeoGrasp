// GeoGrasp — Electron main process
// Copyright (C) 2026 Shawn Rapaz
//
// This program is free software: you can redistribute it and/or modify it under
// the terms of the GNU General Public License as published by the Free Software
// Foundation, either version 3 of the License, or (at your option) any later version.
// This program is distributed WITHOUT ANY WARRANTY. See <https://www.gnu.org/licenses/>.
'use strict';

const { app, BrowserWindow, protocol, net, session, ipcMain, shell, Menu } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const APP_DIR = path.join(__dirname, '..', 'app');
const SCHEME = 'geograsp';

// A privileged custom scheme gives us a secure context (needed for the camera
// and WebAssembly) while serving every file from inside the app — nothing is
// ever loaded from the network.
protocol.registerSchemesAsPrivileged([
  { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

// Music and voice may start without a click (kids' game, no web content).
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

if (!app.requestSingleInstanceLock()) app.quit();

let win = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1366,
    height: 820,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#0b2a4a',
    title: 'GeoGrasp',
    icon: path.join(__dirname, '..', 'build-res', 'icon.png'),
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  Menu.setApplicationMenu(null);
  win.once('ready-to-show', () => win.show());
  win.loadURL(`${SCHEME}://app/index.html`);

  // Never navigate away or open new windows inside the app; external links
  // (website / e-mail in the credits) open in the user's own browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^(https:|mailto:)/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(`${SCHEME}://`)) e.preventDefault();
  });

  win.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && (input.key === 'F11' || (input.alt && input.key === 'Enter'))) {
      win.setFullScreen(!win.isFullScreen());
      e.preventDefault();
    }
    if (input.type === 'keyDown' && input.control && input.shift && input.key.toLowerCase() === 'i') {
      win.webContents.toggleDevTools();
      e.preventDefault();
    }
  });

  // When the window closes the renderer (and with it every camera track) is
  // destroyed. We additionally quit the whole app so the camera device is
  // released by the OS immediately.
  win.on('closed', () => { win = null; app.quit(); });
}

app.whenReady().then(() => {
  protocol.handle(SCHEME, (request) => {
    const url = new URL(request.url);
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    const file = path.normalize(path.join(APP_DIR, rel));
    if (!file.startsWith(APP_DIR)) return new Response('Forbidden', { status: 403 });
    return net.fetch(pathToFileURL(file).toString());
  });

  const ses = session.defaultSession;
  // Only ever allow *video* capture (no microphone), and only for our own pages.
  ses.setPermissionRequestHandler((wc, permission, callback, details) => {
    const own = (details.requestingUrl || '').startsWith(`${SCHEME}://`);
    if (permission === 'media') {
      const types = details.mediaTypes || [];
      return callback(own && types.length > 0 && types.every((t) => t === 'video'));
    }
    callback(false);
  });
  ses.setPermissionCheckHandler((wc, permission, origin) => permission === 'media' && String(origin).startsWith(`${SCHEME}://`));
  // Block any network request that is not our own scheme or devtools.
  ses.webRequest.onBeforeRequest((details, cb) => {
    const ok = /^(geograsp|devtools|data|blob):/.test(details.url);
    cb({ cancel: !ok });
  });

  ipcMain.handle('app:quit', () => app.quit());
  ipcMain.handle('app:fullscreen', () => { if (win) win.setFullScreen(!win.isFullScreen()); });
  createWindow();
});

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.on('window-all-closed', () => app.quit());
