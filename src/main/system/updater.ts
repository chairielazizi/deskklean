import { UpdaterState, UpdaterStatus } from '../../shared/types';

export interface UpdaterDeps {
  autoUpdater?: any;
  app?: {
    isPackaged: boolean;
    getVersion: () => string;
  };
  isPackaged?: boolean;
  isPortable?: boolean;
  currentVersion?: string;
  readSettings?: () => { autoCheckUpdates?: boolean };
  onStatusChange?: (status: UpdaterStatus) => void;
}

export type UpdaterAction =
  | { type: 'CHECK_START' }
  | { type: 'CHECK_AVAILABLE'; version?: string; releaseNotes: string | null }
  | { type: 'CHECK_NOT_AVAILABLE' }
  | { type: 'CHECK_ERROR'; error: string }
  | { type: 'DOWNLOAD_START' }
  | { type: 'DOWNLOAD_PROGRESS'; percent: number | null; bytesPerSecond: number | null }
  | { type: 'DOWNLOAD_COMPLETE'; version?: string }
  | { type: 'DOWNLOAD_ERROR'; error: string }
  | { type: 'SET_UNAVAILABLE'; reason: string }
  | { type: 'SET_DISABLED' }
  | { type: 'SET_IDLE' };

/**
 * Checks whether the current runtime environment supports auto-updating.
 * Dev builds and portable builds are unavailable per Spec §3.1.
 */
export function checkEnvironmentSupport(env: {
  isPackaged: boolean;
  isPortable?: boolean;
}): { supported: boolean; reason?: string } {
  if (
    env.isPortable ||
    (typeof process !== 'undefined' && process.env && process.env.PORTABLE_EXECUTABLE_FILE)
  ) {
    return {
      supported: false,
      reason: 'Portable build cannot self-update. Download new versions manually.',
    };
  }
  if (!env.isPackaged) {
    return {
      supported: false,
      reason: 'Auto-update is unavailable in unpackaged development builds.',
    };
  }
  return { supported: true };
}

/**
 * Pure semver comparison:
 * returns 1 if v1 > v2, -1 if v1 < v2, 0 if equal.
 */
export function compareVersions(v1: string, v2: string): number {
  if (!v1 && !v2) return 0;
  if (!v1) return -1;
  if (!v2) return 1;

  const parse = (v: string) => {
    const clean = v.replace(/^v/i, '').trim();
    const [main, pre] = clean.split('-');
    const parts = (main || '').split('.').map((p) => parseInt(p, 10) || 0);
    while (parts.length < 3) parts.push(0);
    return { parts, pre: pre ? pre.trim() : null };
  };

  const p1 = parse(v1);
  const p2 = parse(v2);

  for (let i = 0; i < 3; i++) {
    if (p1.parts[i] > p2.parts[i]) return 1;
    if (p1.parts[i] < p2.parts[i]) return -1;
  }

  if (p1.pre && !p2.pre) return -1;
  if (!p1.pre && p2.pre) return 1;
  if (p1.pre && p2.pre) {
    return p1.pre.localeCompare(p2.pre);
  }

  return 0;
}

/**
 * Extracts release notes from electron-updater info without inventing or synthesizing content.
 */
export function extractReleaseNotes(raw: any): string | null {
  if (!raw) return null;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    return trimmed.length > 0 ? raw : null;
  }
  if (Array.isArray(raw)) {
    if (raw.length === 0) return null;
    const notes = raw
      .map((item) => {
        if (typeof item === 'string') return item;
        if (item && typeof item === 'object' && typeof item.note === 'string') return item.note;
        return '';
      })
      .filter((s) => s.length > 0)
      .join('\n\n');
    return notes.trim().length > 0 ? notes : null;
  }
  return null;
}

/**
 * Extracts progress percentages honestly: returns null when feed does not report a finite number.
 */
export function extractProgress(progressObj: any): {
  percent: number | null;
  bytesPerSecond: number | null;
} {
  if (!progressObj || typeof progressObj !== 'object') {
    return { percent: null, bytesPerSecond: null };
  }
  let percent: number | null = null;
  if (typeof progressObj.percent === 'number' && Number.isFinite(progressObj.percent)) {
    percent = progressObj.percent;
  }
  let bytesPerSecond: number | null = null;
  if (typeof progressObj.bytesPerSecond === 'number' && Number.isFinite(progressObj.bytesPerSecond)) {
    bytesPerSecond = progressObj.bytesPerSecond;
  }
  return { percent, bytesPerSecond };
}

/**
 * Validates whether a state transition is legal in the state machine.
 */
/**
 * Creates the initial UpdaterStatus.
 */
export function createInitialStatus(
  currentVersion: string = '1.0.0',
  initialState: UpdaterState = 'idle',
  unavailableReason?: string
): UpdaterStatus {
  return {
    state: initialState,
    currentVersion,
    availableVersion: null,
    releaseNotes: null,
    progressPercent: null,
    bytesPerSecond: null,
    lastCheckedAt: null,
    error: null,
    message: initialState === 'unavailable' ? (unavailableReason || 'Auto-update is unavailable') : null,
  };
}

/**
 * Pure state reducer for updater status transitions.
 */
export function updaterReducer(state: UpdaterStatus, action: UpdaterAction): UpdaterStatus {
  switch (action.type) {
    case 'CHECK_START':
      return {
        ...state,
        state: 'checking',
        availableVersion: null,
        error: null,
        message: null,
        progressPercent: null,
        bytesPerSecond: null,
      };
    case 'CHECK_AVAILABLE': {
      const v = action.version;
      if (!v) {
        return {
          ...state,
          state: 'error',
          availableVersion: null,
          releaseNotes: null,
          lastCheckedAt: new Date().toISOString(),
          error: 'Update available, but the feed omitted a version number.',
          message: 'Update available, but the feed omitted a version number.',
          progressPercent: null,
          bytesPerSecond: null,
        };
      }
      return {
        ...state,
        state: 'available',
        availableVersion: v,
        releaseNotes: action.releaseNotes,
        lastCheckedAt: new Date().toISOString(),
        error: null,
        message: null,
        progressPercent: null,
        bytesPerSecond: null,
      };
    }
    case 'CHECK_NOT_AVAILABLE':
      return {
        ...state,
        state: 'not-available',
        availableVersion: null,
        releaseNotes: null,
        lastCheckedAt: new Date().toISOString(),
        error: null,
        message: null,
        progressPercent: null,
        bytesPerSecond: null,
      };
    case 'CHECK_ERROR':
      return {
        ...state,
        state: 'error',
        availableVersion: null,
        lastCheckedAt: new Date().toISOString(),
        error: action.error,
        message: action.error,
        progressPercent: null,
        bytesPerSecond: null,
      };
    case 'DOWNLOAD_START':
      if (state.state !== 'available') {
        throw new Error(
          `Cannot start download: current state is "${state.state}", expected "available"`
        );
      }
      return {
        ...state,
        state: 'downloading',
        progressPercent: null,
        bytesPerSecond: null,
        error: null,
        message: null,
      };
    case 'DOWNLOAD_PROGRESS':
      return {
        ...state,
        state: 'downloading',
        progressPercent: action.percent,
        bytesPerSecond: action.bytesPerSecond,
      };
    case 'DOWNLOAD_COMPLETE':
      return {
        ...state,
        state: 'downloaded',
        availableVersion: action.version || state.availableVersion,
        error: null,
        message: null,
      };
    case 'DOWNLOAD_ERROR':
      return {
        ...state,
        state: 'error',
        error: action.error,
        message: action.error,
      };
    case 'SET_UNAVAILABLE':
      return {
        ...state,
        state: 'unavailable',
        availableVersion: null,
        error: null,
        message: action.reason,
      };
    case 'SET_DISABLED':
      return {
        ...state,
        state: 'disabled',
        error: null,
        message: 'Auto-update is disabled in settings.',
      };
    case 'SET_IDLE':
      return {
        ...state,
        state: 'idle',
        error: null,
        message: null,
      };
  }
}

// Module singleton state
let currentStatus: UpdaterStatus = createInitialStatus();
let activeDeps: UpdaterDeps = {};
let activeAutoUpdater: any = null;
let currentCheckPromise: Promise<UpdaterStatus> | null = null;
let checkAttemptSeq = 0;
let attemptTerminalReached = false;
let autoUpdaterListenersInstalled = false;

function broadcastStatus(): void {
  if (activeDeps.onStatusChange) {
    try {
      activeDeps.onStatusChange(currentStatus);
    } catch (e) {
      console.error('Error in onStatusChange listener:', e);
    }
  }
}

export function dispatch(action: UpdaterAction): UpdaterStatus {
  currentStatus = updaterReducer(currentStatus, action);
  broadcastStatus();
  return currentStatus;
}

function resolveElectronApp(): any {
  try {
    return require('electron').app;
  } catch {
    return null;
  }
}

function resolveElectronAutoUpdater(): any {
  try {
    return require('electron-updater').autoUpdater;
  } catch {
    return null;
  }
}

function setupAutoUpdaterEvents(updaterInstance: any): void {
  if (!updaterInstance || typeof updaterInstance.on !== 'function') return;
  if (autoUpdaterListenersInstalled) return;
  autoUpdaterListenersInstalled = true;

  updaterInstance.on('checking-for-update', () => {
    if (currentStatus.state !== 'checking') {
      dispatch({ type: 'CHECK_START' });
    }
  });

  updaterInstance.on('update-available', (info: any) => {
    if (!attemptTerminalReached) {
      attemptTerminalReached = true;
      if (!info?.version) {
        dispatch({ type: 'CHECK_ERROR', error: 'Update available, but the feed omitted a version number.' });
      } else {
        dispatch({
          type: 'CHECK_AVAILABLE',
          version: info?.version,
          releaseNotes: extractReleaseNotes(info?.releaseNotes),
        });
      }
    }
  });

  updaterInstance.on('update-not-available', (_info: any) => {
    if (!attemptTerminalReached) {
      attemptTerminalReached = true;
      dispatch({ type: 'CHECK_NOT_AVAILABLE' });
    }
  });

  updaterInstance.on('error', (err: any) => {
    if (!attemptTerminalReached) {
      attemptTerminalReached = true;
      const errMsg = err?.message || String(err || 'Update check failed');
      dispatch({ type: 'CHECK_ERROR', error: errMsg });
    }
  });

  updaterInstance.on('download-progress', (progressObj: any) => {
    const { percent, bytesPerSecond } = extractProgress(progressObj);
    dispatch({ type: 'DOWNLOAD_PROGRESS', percent, bytesPerSecond });
  });

  updaterInstance.on('update-downloaded', (info: any) => {
    dispatch({ type: 'DOWNLOAD_COMPLETE', version: info?.version });
  });
}

/**
 * Initializes the updater module. Never throws at startup.
 */
export function initUpdater(deps?: UpdaterDeps): void {
  activeDeps = deps || {};
  autoUpdaterListenersInstalled = false;

  const electronApp = resolveElectronApp();
  const isPortable =
    activeDeps.isPortable ??
    (typeof process !== 'undefined' && !!process.env.PORTABLE_EXECUTABLE_FILE);
  const isPackaged =
    activeDeps.isPackaged ?? activeDeps.app?.isPackaged ?? (electronApp?.isPackaged ?? false);
  const currentVersion =
    activeDeps.currentVersion ??
    activeDeps.app?.getVersion?.() ??
    (electronApp?.getVersion?.() ?? '1.0.0');

  const envSupport = checkEnvironmentSupport({ isPackaged, isPortable });

  if (!envSupport.supported) {
    currentStatus = createInitialStatus(currentVersion, 'unavailable', envSupport.reason);
    activeAutoUpdater = null;
    broadcastStatus();
    return;
  }

  // Check persisted settings if provided
  let autoCheck = true;
  if (activeDeps.readSettings) {
    try {
      const s = activeDeps.readSettings();
      if (typeof s?.autoCheckUpdates === 'boolean') {
        autoCheck = s.autoCheckUpdates;
      }
    } catch {}
  }

  currentStatus = createInitialStatus(currentVersion, autoCheck ? 'idle' : 'disabled');

  const updaterInstance = activeDeps.autoUpdater ?? resolveElectronAutoUpdater();
  if (updaterInstance) {
    activeAutoUpdater = updaterInstance;
    try {
      activeAutoUpdater.autoDownload = false;
      activeAutoUpdater.autoInstallOnAppQuit = false;
    } catch {}
    setupAutoUpdaterEvents(activeAutoUpdater);
  }

  broadcastStatus();
}

/**
 * Returns current updater status. Safe to call before init (returns 'idle').
 */
export function getUpdaterStatus(): UpdaterStatus {
  return currentStatus;
}

/**
 * Checks for updates. Resolves to UpdaterStatus. Sets checking, then available / not-available / error.
 */
export async function checkForUpdates(): Promise<UpdaterStatus> {
  const electronApp = resolveElectronApp();
  const isPortable =
    activeDeps.isPortable ??
    (typeof process !== 'undefined' && !!process.env.PORTABLE_EXECUTABLE_FILE);
  const isPackaged =
    activeDeps.isPackaged ?? activeDeps.app?.isPackaged ?? (electronApp?.isPackaged ?? false);

  const envSupport = checkEnvironmentSupport({ isPackaged, isPortable });
  if (!envSupport.supported) {
    dispatch({ type: 'SET_UNAVAILABLE', reason: envSupport.reason || 'Auto-update is unavailable' });
    return currentStatus;
  }

  if (currentStatus.state === 'checking' && currentCheckPromise) {
    return currentCheckPromise;
  }

  const thisAttemptId = ++checkAttemptSeq;
  attemptTerminalReached = false;

  dispatch({ type: 'CHECK_START' });

  currentCheckPromise = new Promise<UpdaterStatus>(async (resolve) => {
    const complete = () => {
      if (thisAttemptId === checkAttemptSeq) {
        currentCheckPromise = null;
        resolve(currentStatus);
      }
    };

    if (!activeAutoUpdater) {
      if (!attemptTerminalReached) {
        attemptTerminalReached = true;
        dispatch({ type: 'CHECK_ERROR', error: 'Updater not initialized' });
      }
      return complete();
    }

    try {
      const checkResult = await activeAutoUpdater.checkForUpdates();
      // If checkForUpdates() resolved with UpdateCheckResult, evaluate updateInfo
      if (checkResult && checkResult.updateInfo && !attemptTerminalReached) {
        const info = checkResult.updateInfo;
        const isNewer = compareVersions(info.version, currentStatus.currentVersion) > 0;
        attemptTerminalReached = true;
        if (isNewer) {
          dispatch({
            type: 'CHECK_AVAILABLE',
            version: info.version,
            releaseNotes: extractReleaseNotes(info.releaseNotes),
          });
        } else {
          dispatch({ type: 'CHECK_NOT_AVAILABLE' });
        }
      }
      complete();
    } catch (err: any) {
      if (!attemptTerminalReached) {
        attemptTerminalReached = true;
        const errMsg = err?.message || String(err || 'Failed to check for updates');
        dispatch({ type: 'CHECK_ERROR', error: errMsg });
      }
      complete();
    }
  });

  return currentCheckPromise;
}

/**
 * Downloads update. Only legal from 'available'. Resolves to UpdaterStatus.
 */
export async function downloadUpdate(): Promise<UpdaterStatus> {
  if (currentStatus.state !== 'available') {
    throw new Error(
      `Cannot download update: current state is "${currentStatus.state}", expected "available"`
    );
  }

  dispatch({ type: 'DOWNLOAD_START' });

  if (!activeAutoUpdater) {
    dispatch({ type: 'DOWNLOAD_ERROR', error: 'Updater not initialized' });
    throw new Error('Updater not initialized');
  }

  try {
    if (typeof activeAutoUpdater.downloadUpdate === 'function') {
      await activeAutoUpdater.downloadUpdate();
    }
    return currentStatus;
  } catch (err: any) {
    const errMsg = err?.message || String(err || 'Failed to download update');
    dispatch({ type: 'DOWNLOAD_ERROR', error: errMsg });
    throw err;
  }
}

/**
 * Installs update. Only legal from 'downloaded'. Calls autoUpdater.quitAndInstall().
 */
export function quitAndInstall(): void {
  if (currentStatus.state !== 'downloaded') {
    throw new Error(
      `Cannot install update: current state is "${currentStatus.state}", expected "downloaded"`
    );
  }

  if (!activeAutoUpdater) {
    throw new Error('Updater not initialized');
  }

  if (typeof activeAutoUpdater.quitAndInstall === 'function') {
    activeAutoUpdater.quitAndInstall();
  }
}

/**
 * Resets updater state for unit testing.
 */
export function resetUpdaterForTesting(): void {
  currentStatus = createInitialStatus();
  activeDeps = {};
  activeAutoUpdater = null;
  currentCheckPromise = null;
  checkAttemptSeq = 0;
  attemptTerminalReached = false;
  autoUpdaterListenersInstalled = false;
}
