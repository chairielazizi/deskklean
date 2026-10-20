import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS } from '../shared/constants';
import {
  DeskKleanAPI,
  SystemSpecs,
  HealthReport,
  SmartCleanReport,
  SmartCleanScanResult,
  SmartCleanResult,
  RegistryScanResult,
  RegistryBackup,
  StartupItem,
  StartupDelayState,
  StartupBackup,
  OperationPlan,
  ExecuteResult,
  InstalledApp,
  AppUninstallResult,
  BrowserExtension,
  BrowserType,
  DuplicateGroup,
  DuplicateScanConfig,
  DuplicateScanResult,
  ShredMethodId,
  AppSettings,
  ActivityItem,
  DiskAnalysisResult,
  ScanProgressEvent,
} from '../shared/types';

const api: DeskKleanAPI = {
  // Window controls
  minimizeWindow: () => ipcRenderer.invoke(IPC_CHANNELS.WINDOW_MINIMIZE),
  maximizeWindow: () => ipcRenderer.invoke(IPC_CHANNELS.WINDOW_MAXIMIZE),
  closeWindow: () => ipcRenderer.invoke(IPC_CHANNELS.WINDOW_CLOSE),
  isMaximized: () => ipcRenderer.invoke(IPC_CHANNELS.WINDOW_IS_MAXIMIZED),

  // System
  getSystemSpecs: (): Promise<SystemSpecs> => ipcRenderer.invoke(IPC_CHANNELS.SYSTEM_GET_SPECS),
  getTelemetry: () => ipcRenderer.invoke(IPC_CHANNELS.SYSTEM_GET_TELEMETRY),

  // Health Check
  getHealthReport: (): Promise<HealthReport> => ipcRenderer.invoke(IPC_CHANNELS.HEALTH_GET_REPORT),

  // Smart Clean
  scanSmartClean: (categories?: string[]): Promise<SmartCleanReport> =>
    ipcRenderer.invoke(IPC_CHANNELS.SMART_CLEAN_SCAN, categories),
  executeSmartClean: (categoryIds?: string[]): Promise<ExecuteResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.SMART_CLEAN_EXECUTE, categoryIds),

  // Registry
  scanRegistry: (): Promise<RegistryScanResult> => ipcRenderer.invoke(IPC_CHANNELS.REGISTRY_SCAN),
  fixRegistryIssues: (issueIds?: string[]) =>
    ipcRenderer.invoke(IPC_CHANNELS.REGISTRY_FIX, issueIds),
  planRegistryFix: (issueIds?: string[]) =>
    ipcRenderer.invoke(IPC_CHANNELS.FRAMEWORK_PLAN, 'registry-fixer', { selectedIssueIds: issueIds }),
  getRegistryBackups: (): Promise<RegistryBackup[]> => ipcRenderer.invoke(IPC_CHANNELS.REGISTRY_GET_BACKUPS),
  restoreRegistryBackup: (backupId: string) => ipcRenderer.invoke(IPC_CHANNELS.REGISTRY_RESTORE_BACKUP, backupId),

  // App / Elevation
  isElevated: (): Promise<boolean> => ipcRenderer.invoke(IPC_CHANNELS.APP_IS_ELEVATED),
  relaunchElevated: (): Promise<{ success: boolean; message?: string }> =>
    ipcRenderer.invoke(IPC_CHANNELS.APP_RELAUNCH_ELEVATED),

  // Startup
  getStartupItems: (): Promise<StartupItem[]> => ipcRenderer.invoke(IPC_CHANNELS.STARTUP_GET_ITEMS),
  toggleStartupItem: (id: string, enabled: boolean) =>
    ipcRenderer.invoke(IPC_CHANNELS.STARTUP_TOGGLE_ITEM, id, enabled),
  getStartupDelay: (): Promise<StartupDelayState> => ipcRenderer.invoke(IPC_CHANNELS.STARTUP_GET_DELAY),
  setStartupDelay: (ms: number | null, waitForIdle: boolean) =>
    ipcRenderer.invoke(IPC_CHANNELS.STARTUP_SET_DELAY, ms, waitForIdle),
  getStartupBackups: (): Promise<StartupBackup[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.STARTUP_GET_BACKUPS),
  restoreStartupBackup: (id: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.STARTUP_RESTORE_BACKUP, id),
  planStartupRestore: (id: string): Promise<OperationPlan> =>
    ipcRenderer.invoke(IPC_CHANNELS.STARTUP_PLAN_RESTORE, id),
  executeOperationPlan: (planId: string): Promise<ExecuteResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.FRAMEWORK_EXECUTE, planId),

  // Apps
  getInstalledApps: (): Promise<InstalledApp[]> => ipcRenderer.invoke(IPC_CHANNELS.APPS_GET_INSTALLED),
  uninstallApp: (appId: string, deepCleanLeftovers?: boolean): Promise<AppUninstallResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.APPS_UNINSTALL, appId, deepCleanLeftovers),
  planAppUninstall: (appId: string): Promise<OperationPlan> =>
    ipcRenderer.invoke(IPC_CHANNELS.FRAMEWORK_PLAN, 'app-remover', { appId }),
  removeAppRegistryEntry: (appId: string): Promise<ExecuteResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.APPS_REMOVE_ENTRY_ONLY, appId),

  // Extensions
  getBrowserExtensions: (browser?: BrowserType): Promise<BrowserExtension[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.EXTENSIONS_GET, browser),
  toggleExtension: (id: string, enabled: boolean) =>
    ipcRenderer.invoke(IPC_CHANNELS.EXTENSIONS_TOGGLE, id, enabled),
  removeExtension: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.EXTENSIONS_REMOVE, id),

  // Disk Analyzer
  analyzeDisk: (drivePath: string): Promise<DiskAnalysisResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.DISK_ANALYZE, drivePath),
  cancelDiskAnalysis: () => ipcRenderer.invoke(IPC_CHANNELS.DISK_CANCEL),
  onDiskScanProgress: (callback: (progress: ScanProgressEvent) => void) => {
    const listener = (_: unknown, progress: ScanProgressEvent) => callback(progress);
    ipcRenderer.on(IPC_CHANNELS.DISK_SCAN_PROGRESS, listener);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.DISK_SCAN_PROGRESS, listener);
    };
  },

  // Duplicate Finder
  scanDuplicates: (config: DuplicateScanConfig): Promise<DuplicateScanResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.DUPLICATES_SCAN, config),
  deleteDuplicateFiles: (fileIds: string[]): Promise<ExecuteResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.DUPLICATES_DELETE, fileIds),
  planDuplicateDelete: (fileIds?: string[]): Promise<OperationPlan> =>
    ipcRenderer.invoke(IPC_CHANNELS.FRAMEWORK_PLAN, 'duplicate-finder', { fileIds }),

  // Secure Erase
  shredItems: (paths: string[], methodId: ShredMethodId) =>
    ipcRenderer.invoke(IPC_CHANNELS.SHRED_ITEMS, paths, methodId),
  wipeFreeSpace: (driveLetter: string, methodId: ShredMethodId) =>
    ipcRenderer.invoke(IPC_CHANNELS.WIPE_FREE_SPACE, driveLetter, methodId),

  // Settings
  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_GET),
  saveSettings: (settings: Partial<AppSettings>) => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_SAVE, settings),

  // Activity Log
  getActivityLogs: (): Promise<ActivityItem[]> => ipcRenderer.invoke(IPC_CHANNELS.LOGS_GET),
};

contextBridge.exposeInMainWorld('deskKleanAPI', api);
