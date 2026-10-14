import { app } from 'electron';

export function setAutoLaunch(enabled: boolean): void {
  if (process.platform === 'win32') {
    app.setLoginItemSettings({
      openAtLogin: enabled,
      path: app.getPath('exe'),
      args: ['--hidden'],
    });
  }
}

export function getAutoLaunchStatus(): boolean {
  if (process.platform === 'win32') {
    const settings = app.getLoginItemSettings();
    return settings.openAtLogin;
  }
  return false;
}
