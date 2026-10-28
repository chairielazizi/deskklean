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
  LeftoverScanResult,
  BrowserExtension,
  BrowserType,
  BrowserId,
  ExtensionItem,
  ExtensionScanResult,
  ExtensionOpenResult,
  ExtensionPageTarget,
  DuplicateGroup,
  DuplicateScanConfig,
  DuplicateScanResult,
  ShredMethodId,
  ShredOptions,
  WipeOptions,
  ShredResult,
  WipeResult,
  AppSettings,
  CustomCleanRule,
  CustomRuleValidationResult,
  CustomRuleScanResult,
  ActivityItem,
  DiskAnalysisResult,
  ScanProgressEvent,
  UpdaterStatus,
  ScheduledCleanState,
  SetScheduledCleanResult,
  ScheduledCleanReport,
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
  getInstalledApps: (forceRefresh?: boolean): Promise<InstalledApp[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.APPS_GET_INSTALLED, forceRefresh),
  uninstallApp: (appId: string): Promise<AppUninstallResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.APPS_UNINSTALL, appId),
  planAppUninstall: (appId: string): Promise<OperationPlan> =>
    ipcRenderer.invoke(IPC_CHANNELS.FRAMEWORK_PLAN, 'app-remover', { appId }),
  removeAppRegistryEntry: (appId: string): Promise<ExecuteResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.APPS_REMOVE_ENTRY_ONLY, appId),
  scanLeftovers: (appId: string): Promise<LeftoverScanResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.APPS_SCAN_LEFTOVERS, appId),
  cleanLeftovers: (
    appId: string,
    candidateIds: string[]
  ): Promise<ExecuteResult & { leftoversCleanedCount: number }> =>
    ipcRenderer.invoke(IPC_CHANNELS.APPS_CLEAN_LEFTOVERS, appId, candidateIds),

  // Updater
  getUpdaterStatus: (): Promise<UpdaterStatus> =>
    ipcRenderer.invoke(IPC_CHANNELS.UPDATER_GET_STATUS),
  checkForUpdates: (): Promise<UpdaterStatus> =>
    ipcRenderer.invoke(IPC_CHANNELS.UPDATER_CHECK),
  downloadUpdate: (): Promise<UpdaterStatus> =>
    ipcRenderer.invoke(IPC_CHANNELS.UPDATER_DOWNLOAD),
  installUpdate: (): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.UPDATER_INSTALL),
  onUpdaterStatus: (callback: (status: UpdaterStatus) => void) => {
    const listener = (_: unknown, status: UpdaterStatus) => callback(status);
    ipcRenderer.on(IPC_CHANNELS.UPDATER_STATUS, listener);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.UPDATER_STATUS, listener);
    };
  },

  // Extensions
  getBrowserExtensions: (): Promise<ExtensionScanResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.EXTENSIONS_GET),
  openExtensionPage: (target: ExtensionPageTarget | BrowserId): Promise<ExtensionOpenResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.EXTENSIONS_OPEN_PAGE, target),
  rescanExtensions: (): Promise<ExtensionScanResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.EXTENSIONS_RESCAN),

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
  shredItems: (
    paths: string[],
    methodId?: ShredMethodId | number,
    options?: Partial<ShredOptions>
  ): Promise<ShredResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.SHRED_ITEMS, paths, methodId, options),
  wipeFreeSpace: (
    driveLetter: string,
    methodId?: ShredMethodId | number,
    options?: Partial<WipeOptions>
  ): Promise<WipeResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.WIPE_FREE_SPACE, driveLetter, methodId, options),
  planShred: (paths: string[], passes?: number): Promise<OperationPlan> =>
    ipcRenderer.invoke(IPC_CHANNELS.FRAMEWORK_PLAN, 'secure-erase', { paths, passes }),
  planWipeFreeSpace: (volumeRoot: string): Promise<OperationPlan> =>
    ipcRenderer.invoke(IPC_CHANNELS.FRAMEWORK_PLAN, 'secure-erase', { type: 'wipe', volumeRoot }),
  isTargetSsd: (targetPath: string): Promise<boolean | null> =>
    ipcRenderer.invoke(IPC_CHANNELS.SHRED_IS_SSD, targetPath),

  // Settings
  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_GET),
  saveSettings: (settings: Partial<AppSettings>) => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_SAVE, settings),
  validateCustomRule: (rule: CustomCleanRule): Promise<CustomRuleValidationResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.CUSTOM_RULES_VALIDATE, rule),

  // Custom Rules
  scanCustomRules: (rules?: CustomCleanRule[]): Promise<CustomRuleScanResult[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.CUSTOM_RULES_SCAN, rules),
  planCustomRules: (
    scanResults: CustomRuleScanResult[],
    selectedRuleIds?: string[]
  ): Promise<OperationPlan> =>
    ipcRenderer.invoke(IPC_CHANNELS.CUSTOM_RULES_PLAN, scanResults, selectedRuleIds),

  // Scheduled Cleaning (Phase 18)
  getScheduledCleanState: (): Promise<ScheduledCleanState | null> =>
    ipcRenderer.invoke(IPC_CHANNELS.SCHEDULED_GET_STATE),
  setScheduledCleanEnabled: (params: {
    enabled: boolean;
    frequency?: 'daily' | 'weekly' | 'monthly';
  }): Promise<SetScheduledCleanResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.SCHEDULED_SET_ENABLED, params),
  runScheduledCleanNow: (): Promise<{ report: ScheduledCleanReport; exitCode: number }> =>
    ipcRenderer.invoke(IPC_CHANNELS.SCHEDULED_RUN_NOW),
  isPortable: (): Promise<boolean> =>
    ipcRenderer.invoke(IPC_CHANNELS.APP_IS_PORTABLE),

  // Activity Log
  getActivityLogs: (): Promise<ActivityItem[]> => ipcRenderer.invoke(IPC_CHANNELS.LOGS_GET),
};

contextBridge.exposeInMainWorld('deskKleanAPI', api);
