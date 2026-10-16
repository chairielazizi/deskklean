// DeskKlean Shared Types

export type ModuleId =
  | 'dashboard'
  | 'health-check'
  | 'smart-clean'
  | 'registry-fixer'
  | 'startup-optimizer'
  | 'app-remover'
  | 'extension-manager'
  | 'disk-analyzer'
  | 'duplicate-finder'
  | 'secure-erase'
  | 'system-info'
  | 'settings';

export type SystemStatus = 'optimal' | 'warning' | 'critical' | 'scanning' | 'cleaning';

// System Info
export interface OSInfo {
  platform: string;
  distro: string;
  release: string;
  build: string;
  arch: string;
  hostname: string;
  uptimeSeconds: number;
  isWindows: boolean;
  activationStatus: string;
}

export interface CPUInfo {
  manufacturer: string;
  brand: string;
  speedGhz: number | null;
  cores: number;
  physicalCores: number;
  usagePercent: number | null;
  tempC?: number | null;
}

export interface MemoryInfo {
  totalBytes: number;
  usedBytes: number;
  freeBytes: number;
  usagePercent: number;
  speedMhz?: number | null;
  type?: string | null;
}

export interface DriveInfo {
  id: string;
  mount: string;
  label: string;
  type: string;
  totalBytes: number;
  usedBytes: number;
  freeBytes: number;
  usagePercent: number | null;
  fileSystem: string;
  healthStatus: 'good' | 'warning' | 'bad' | 'critical';
}

export interface GPUInfo {
  model: string;
  vramMb: number | null;
  driverVersion: string | null;
  usagePercent: number | null;
  tempC?: number | null;
}

export interface MotherboardInfo {
  manufacturer: string;
  model: string;
  biosVersion: string;
  biosDate: string | null;
}

export interface NetworkInfo {
  interfaceName: string;
  ipAddress: string;
  macAddress: string;
  linkSpeedMbps: number | null;
  rxBytesSec: number;
  txBytesSec: number;
}

export interface SystemSpecs {
  os: OSInfo;
  cpu: CPUInfo;
  memory: MemoryInfo;
  drives: DriveInfo[];
  gpu: GPUInfo;
  motherboard: MotherboardInfo;
  network: NetworkInfo;
}

// Health Check
export type HealthCategory = 'privacy' | 'junk' | 'registry' | 'startup' | 'security';
export type IssueSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface HealthIssue {
  id: string;
  category: HealthCategory;
  title: string;
  description: string;
  count: number;
  spaceReclaimableBytes: number;
  severity: IssueSeverity;
  fixable: boolean;
  selected: boolean;
}

export interface HealthCheckResult {
  score: number;
  issues: HealthIssue[];
  scannedAt: string;
  totalSpaceBytes: number;
}

// Smart Clean
export type CleanItemCategory = 'windows' | 'browser' | 'application';

export interface CleanSubcategory {
  id: string;
  name: string;
  category: CleanItemCategory;
  description: string;
  enabled: boolean;
  itemCount: number;
  sizeBytes: number;
  files?: Array<{ path: string; sizeBytes: number }>;
}

export interface SmartCleanScanResult {
  items: CleanSubcategory[];
  totalSizeBytes: number;
  totalItemCount: number;
  scanDurationMs: number;
}

export interface SmartCleanResult {
  success: boolean;
  cleanedSizeBytes: number;
  cleanedItemCount: number;
  errors: Array<{ path: string; error: string }>;
  cleanedAt: string;
}

// Registry Fixer
export type RegistrySeverity = 'low' | 'medium' | 'high';
export type RegistryIssueType =
  | 'missing_dll'
  | 'unused_extension'
  | 'broken_shortcut'
  | 'orphaned_key'
  | 'activex_com'
  | 'type_library'
  | 'app_path'
  | 'installer_cache'
  | 'mui_cache';

export interface RegistryIssue {
  id: string;
  type: RegistryIssueType;
  categoryName: string;
  keyPath: string;
  valueName?: string;
  data?: string;
  description: string;
  severity: RegistrySeverity;
  selected: boolean;
}

export interface RegistryBackup {
  id: string;
  timestamp: string;
  filePath: string;
  issueCount: number;
  sizeBytes: number;
}

// Startup Optimizer
export type StartupImpact = 'high' | 'medium' | 'low' | 'none';
export type StartupLocation =
  | 'HKCU_RUN'
  | 'HKCU_RUNONCE'
  | 'HKLM_RUN'
  | 'HKLM_RUNONCE'
  | 'STARTUP_FOLDER'
  | 'SCHEDULED_TASK'
  | 'SERVICE';

export interface StartupItemTarget {
  kind: 'registry' | 'folder' | 'task';
  hive?: 'HKCU' | 'HKLM';
  keyPath?: string;            // the Run/RunOnce key this item came from
  valueName?: string;          // EXACT registry value name, original case
  approvedKeyPath?: string;    // StartupApproved key for this item, if it has one
  approvedValueName?: string;  // value name within the StartupApproved key
  taskPath?: string;           // scheduled tasks
  taskName?: string;
}

export interface StartupItem {
  id: string;
  name: string;
  publisher: string;
  command: string;
  location: StartupLocation;
  impact: StartupImpact;
  enabled: boolean;
  estimatedBootImpactMs: number | null;
  source?: 'registry' | 'folder' | 'task';
  target: StartupItemTarget;
}

export interface StartupDelayState {
  delayMs: number | null;
  waitForIdle: boolean | null;
  supported: boolean;
}

export interface StartupBackup {
  id: string;
  timestamp: string;
  filePath: string;
  itemName: string;
  hive: 'HKCU' | 'HKLM';
  location: string;
  valueName: string;
  changeSummary: string;
  sizeBytes: number;
}

// Phase 3 Destructive Framework types
export type ActionKind =
  | 'delete-file'
  | 'delete-tree'
  | 'overwrite-file'
  | 'registry-value'
  | 'registry-key'
  | 'scheduled-task'
  | 'uninstall';

export type Reversibility = 'reversible' | 'irreversible';

export interface PlannedAction {
  id: string;
  kind: ActionKind;
  target: string;
  description: string;
  reclaimableBytes: number | null;
  metadata?: Record<string, unknown>;
}

export interface BlockedAction {
  target: string;
  reason: string;
}

export interface OperationPlan {
  id: string;
  module: string;
  actions: PlannedAction[];
  blocked: BlockedAction[];
  totalReclaimableBytes: number | null;
  reversibility: Reversibility;
  irreversibilityReason?: string;
  requiresElevation: boolean;
  createdAt: string;
}

export interface ExecuteFailure {
  target: string;
  error: string;
}

export interface ExecuteResult {
  success: boolean;
  completed: number;
  failed: number;
  skipped: number;
  reclaimableBytes: number | null;
  failures: ExecuteFailure[];
  backupPath?: string;
  message?: string;
}

// App Remover
export interface InstalledApp {
  id: string;
  name: string;
  publisher: string;
  version: string;
  installDate: string;
  sizeBytes: number;
  installLocation: string;
  uninstallString: string;
  iconUrl?: string;
  leftoversDetected: number;
  isSystemComponent?: boolean;
}

export interface AppUninstallResult {
  appId: string;
  success: boolean;
  leftoversCleanedCount: number;
  message: string;
}

// Extension Manager
export type BrowserType = 'chrome' | 'edge' | 'firefox' | 'brave';
export type ExtensionPermissionRisk = 'safe' | 'moderate' | 'high';

export interface BrowserExtension {
  id: string;
  browser: BrowserType;
  name: string;
  version: string;
  description: string;
  enabled: boolean;
  permissions: string[];
  riskLevel: ExtensionPermissionRisk;
  path: string;
}

// Disk Space Analyzer
export type DiskFileType = 'video' | 'audio' | 'image' | 'document' | 'archive' | 'system' | 'other';

export interface FileTypeBreakdown {
  type: DiskFileType;
  label: string;
  totalBytes: number;
  percentage: number;
  color: string;
  count: number;
}

export interface DiskFolderNode {
  name: string;
  path: string;
  sizeBytes: number;
  percentage: number;
  fileCount: number;
  children?: DiskFolderNode[];
}

export interface LargeFileInfo {
  id: string;
  name: string;
  path: string;
  sizeBytes: number;
  extension: string;
  lastModified: string;
}

// Duplicate File Finder
export interface DuplicateFile {
  id: string;
  path: string;
  name: string;
  sizeBytes: number;
  hash: string;
  lastModified: string;
  selectedForDeletion: boolean;
  isOriginal: boolean;
}

export interface DuplicateGroup {
  hash: string;
  fileName: string;
  sizeBytes: number;
  wastedBytes: number;
  files: DuplicateFile[];
}

export interface DuplicateScanConfig {
  directories: string[];
  matchBy: 'hash' | 'name-size';
  fileTypes: string[];
  minSizeBytes: number;
}

// Secure Erase
export type ShredMethodId = 'zero_1' | 'dod_3' | 'dod_7' | 'gutmann_35';

export interface ShredMethod {
  id: ShredMethodId;
  name: string;
  passes: number;
  description: string;
  compliance: string;
}

export interface ShredProgress {
  active: boolean;
  targetPath: string;
  currentPass: number;
  totalPasses: number;
  percent: number;
  bytesWritten: number;
  totalBytes: number;
  currentSpeedBytesSec: number;
}

// Settings
export interface CustomCleanRule {
  id: string;
  name: string;
  directoryPath: string;
  filePattern: string;
  recursive: boolean;
  enabled: boolean;
}

export interface AppSettings {
  theme: 'cyber-slate' | 'deep-oled' | 'midnight-navy' | 'amethyst';
  accentColor: 'emerald' | 'cyan' | 'violet' | 'blue';
  autoCheckUpdates: boolean;
  minimizeToTray: boolean;
  closeToTray: boolean;
  runAtStartup: boolean;
  confirmBeforeDelete: boolean;
  autoRegistryBackup: boolean;
  bypassRecycleBinWarning: boolean;
  excludedPaths: string[];
  customRules: CustomCleanRule[];
  scheduledCleanEnabled: boolean;
  scheduledCleanFrequency: 'daily' | 'weekly' | 'monthly';
  elevationPromptDismissed: boolean;
}

// Activity Log
export interface ActivityItem {
  id: string;
  timestamp: string;
  module: ModuleId;
  title: string;
  detail: string;
  type: 'info' | 'success' | 'warning' | 'error';
  spaceFreedBytes?: number;
}

// Window Bridge API
export interface DeskKleanAPI {
  // Window controls
  minimizeWindow: () => Promise<void>;
  maximizeWindow: () => Promise<void>;
  closeWindow: () => Promise<void>;
  isMaximized: () => Promise<boolean>;

  // System
  getSystemSpecs: () => Promise<SystemSpecs>;
  getTelemetry: () => Promise<{ cpu: number; memory: number; diskRead: number; diskWrite: number }>;

  // Health Check
  runHealthCheckScan: () => Promise<HealthCheckResult>;
  fixHealthIssues: (issueIds: string[]) => Promise<{ success: boolean; fixedCount: number; freedBytes: number }>;

  // Smart Clean
  scanSmartClean: (categories: string[]) => Promise<SmartCleanScanResult>;
  executeSmartClean: (selectedSubcategoryIds: string[]) => Promise<SmartCleanResult>;

  // Registry
  scanRegistry: () => Promise<RegistryIssue[]>;
  fixRegistryIssues: (
    issueIds: string[],
    createBackup: boolean
  ) => Promise<{ success: boolean; fixedCount: number; backupPath?: string; message?: string }>;
  getRegistryBackups: () => Promise<RegistryBackup[]>;
  restoreRegistryBackup: (backupId: string) => Promise<{ success: boolean; message: string }>;

  // App / Elevation
  isElevated: () => Promise<boolean>;
  relaunchElevated: () => Promise<{ success: boolean; message?: string }>;

  // Startup
  getStartupItems: () => Promise<StartupItem[]>;
  toggleStartupItem: (id: string, enabled: boolean) => Promise<{ success: boolean; message?: string; backupPath?: string }>;
  getStartupDelay: () => Promise<StartupDelayState>;
  setStartupDelay: (ms: number | null, waitForIdle: boolean) => Promise<{ success: boolean; message?: string }>;
  getStartupBackups: () => Promise<StartupBackup[]>;
  restoreStartupBackup: (id: string) => Promise<{ success: boolean; message?: string }>;
  planStartupRestore: (id: string) => Promise<OperationPlan>;
  executeOperationPlan: (planId: string) => Promise<ExecuteResult>;

  // Apps
  getInstalledApps: () => Promise<InstalledApp[]>;
  uninstallApp: (appId: string, deepCleanLeftovers: boolean) => Promise<AppUninstallResult>;

  // Extensions
  getBrowserExtensions: (browser?: BrowserType) => Promise<BrowserExtension[]>;
  toggleExtension: (id: string, enabled: boolean) => Promise<{ success: boolean }>;
  removeExtension: (id: string) => Promise<{ success: boolean }>;

  // Disk Analyzer
  analyzeDisk: (drivePath: string) => Promise<{
    breakdown: FileTypeBreakdown[];
    folderTree: DiskFolderNode;
    largeFiles: LargeFileInfo[];
    totalBytes: number;
    freeBytes: number;
  }>;

  // Duplicate Finder
  scanDuplicates: (config: DuplicateScanConfig) => Promise<DuplicateGroup[]>;
  deleteDuplicateFiles: (fileIds: string[]) => Promise<{ success: boolean; deletedCount: number; freedBytes: number }>;

  // Secure Erase
  shredItems: (paths: string[], methodId: ShredMethodId) => Promise<{ success: boolean; shreddedCount: number }>;
  wipeFreeSpace: (driveLetter: string, methodId: ShredMethodId) => Promise<{ success: boolean; wipedBytes: number }>;

  // Settings
  getSettings: () => Promise<AppSettings>;
  saveSettings: (settings: Partial<AppSettings>) => Promise<{ success: boolean }>;

  // Activity Log
  getActivityLogs: () => Promise<ActivityItem[]>;
}

declare global {
  interface Window {
    deskKleanAPI?: DeskKleanAPI;
  }
}
