import { Tray, Menu, nativeImage, app } from 'electron';
import path from 'path';
import { BrowserWindow } from 'electron';

let tray: Tray | null = null;

export function createTray(mainWindow: BrowserWindow): void {
  // Create a simple 16x16 tray icon using nativeImage
  const icon = nativeImage.createFromDataURL(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAABHNCSVQICAgIfAhkiAAAAAlwSFlzAAAAdgAAAHYBT4jsZAAAABl0RVh0U29mdHdhcmUAd3d3Lmlua3NjYXBlLm9yZ5vuPBoAAABPSURBVDhPY/j//z8DMYCJgUQwagDDYBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgQAAAP//AwD+9wf8uBqB5QAAAABJRU5ErkJggg=='
  );

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Open DeskKlean',
      click: () => {
        mainWindow.show();
        mainWindow.focus();
      },
    },
    { type: 'separator' },
    {
      label: 'Quick Scan',
      click: () => {
        mainWindow.webContents.send('tray:quick-scan');
      },
    },
    {
      label: 'Smart Clean',
      click: () => {
        mainWindow.webContents.send('tray:smart-clean');
      },
    },
    { type: 'separator' },
    {
      label: 'Settings',
      click: () => {
        mainWindow.webContents.send('tray:open-settings');
      },
    },
    {
      label: 'Quit',
      click: () => {
        app.quit();
      },
    },
  ]);

  tray = new Tray(icon);
  tray.setContextMenu(contextMenu);
  tray.setToolTip('DeskKlean - System Cleanup & Optimization');

  tray.on('double-click', () => {
    mainWindow.show();
    mainWindow.focus();
  });
}

export function destroyTray(): void {
  if (tray) {
    tray.destroy();
    tray = null;
  }
}
