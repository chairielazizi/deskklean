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
  fileSystem: string | null;
  healthStatus: 'good' | 'warning' | 'bad' | 'critical' | null;
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
export interface HealthReport {
  generatedAt: string;                    // ISO 8601
  score: number | null;                   // null when zero components measured
  components: HealthComponentResult[];    // one per constituent module
  unmeasured: string[];                   // names of modules not yet built
}

export interface HealthComponentResult {
  module: string;                         // 'SmartClean' | 'SystemInfo' | ...
  status: 'ok' | 'partial' | 'failed' | 'not_built';
  measurements: HealthMeasurement[];      // real values only
  issues: HealthIssue[];                  // derived from real measurements only
}

export interface HealthMeasurement {
  label: string;                          // e.g. 'Free disk space (C:)'
  value: number;                          // bytes, count, or percent — never null
  unit: 'bytes' | 'count' | 'percent';
  source: string;                         // which module returned it
}

export interface HealthIssue {
  module: string;
  severity: 'info' | 'warning' | 'critical';
  description: string;
  measurementRef: string;                 // label of the measurement that triggered it
  deepLink: string;                       // which module's UI addresses it
}

// Smart Clean (Phase 5 Read-Only Specification)
export type SmartCleanVerdict = 'SAFE' | 'CONDITIONAL';
export type ExcludedVerdict = 'RISKY' | 'CONDITIONAL';
export type SmartCleanCategoryStatus = 'scanned' | 'partial' | 'failed' | 'not_measured';

export interface SmartCleanFileEntry {
  path: string;
  sizeBytes: number;
}

export interface SmartCleanSkippedFile {
  path: string;
  reason: string;
}

export interface SmartCleanCategory {
  id: string;                             // stable slug, e.g. 'user-temp'
  name: string;                           // display name
  path: string;                           // root path scanned
  verdict: SmartCleanVerdict;             // from the research file
  source: string;                         // URL the verdict came from
  reclaimableBytes: number | null;        // null when not measurable
  fileCount: number | null;               // null when not measurable
  inUseCount: number;                     // files skipped because locked
  status: SmartCleanCategoryStatus;
  failureReason?: string;
  files?: SmartCleanFileEntry[];
  skippedFiles?: SmartCleanSkippedFile[];
  adminRequired?: boolean;
  deletionMethod?: 'permanent' | 'recycle-bin';
  defaultEnabled?: boolean;
  consequence?: string;
}

export interface ExcludedCategory {
  name: string;
  path: string;
  reason: string;
  verdict: ExcludedVerdict;
  source?: string;
}

export interface SmartCleanReport {
  generatedAt: string;
  scanDurationMs: number;                 // real elapsed time
  categories: SmartCleanCategory[];
  excluded: ExcludedCategory[];           // always shown, with reasons
  totalReclaimableBytes: number;          // sum of real measurements, never estimated
  customRules?: CustomRuleScanResult[];   // Phase 17 additive
}

// Legacy Smart Clean Types (Retained for backwards compatibility)
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
export type RegistryFixerIssueType = 'orphaned_uninstall' | 'stale_mui_cache';

export interface RegistryFixerIssue {
  id: string;
  type: RegistryFixerIssueType;
  hive: 'HKCU' | 'HKLM';
  keyPath: string;            // registry key path (without hive prefix)
  valueName?: string;         // for MUICache: the value name; for uninstall: undefined (whole key)
  displayName: string;        // human-readable name
  description: string;        // why it was flagged (the proof)
  severity: 'low';            // both categories are low-risk housekeeping
  selected: boolean;
  evidence: {
    checkedPath: string;      // the filesystem path that was checked
    outcome: 'gone';          // only "gone" is ever flagged — see the three-outcome check
  };
}

export type PathCheckOutcome = 'exists' | 'gone' | 'indeterminate';

export interface RegistryScanResult {
  issues: RegistryFixerIssue[];
  scannedAt: string;
  indeterminateCount: number;    // entries that could NOT be checked (EACCES, EIO, ...)
  skippedNetworkCount: number;   // entries skipped because their path is on a network
}

export interface RegistryFixerResult {
  success: boolean;
  fixedCount: number;
  failedCount?: number;
  backupPath?: string;
  message?: string;
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
  bytesWritten?: number;
}

// App Remover
export type UninstallMethod = 'msi' | 'uninstall-string' | 'store' | 'unavailable';

export interface InstalledApp {
  id: string;                    // key name (product code or GUID or PackageFullName) — stable
  name: string;                  // DisplayName
  publisher: string;             // Publisher
  version: string;               // DisplayVersion
  installDate: string;           // InstallDate, normalised (YYYY-MM-DD)
  sizeBytes: number | null;      // EstimatedSize (KB) * 1024, or null if absent
  installLocation: string;       // InstallLocation
  uninstallString: string | null;       // UninstallString, or null
  quietUninstallString: string | null;  // QuietUninstallString, or null
  productCode: string | null;           // PSComponentID or GUID key name, or null
  isMsi: boolean;                // true when productCode is present
  isStoreApp: boolean;           // true for MSIX/UWP apps
  uninstallMethod: UninstallMethod;
  iconUrl?: string;
  leftoversDetected: number | null; // null when leftover scan is not supported/not measured; AppRemover does not scan leftovers in v1
  isSystemComponent?: boolean;   // always false — system components excluded
  hive?: 'HKCU' | 'HKLM';        // registry hive
  keyPath?: string;              // subkey path without hive prefix
  registryKey?: string;          // full registry key path
  packageFamilyName?: string;    // for Store apps
  isProvisioned?: boolean;       // for Store apps: all users vs current user
  nonRemovable?: boolean;        // for Store apps: protected system apps
}

export type LeftoverConfidence = 'high' | 'medium';

export interface LeftoverCandidate {
  id: string;
  kind: 'file' | 'directory' | 'registry-key';
  path: string;                 // absolute path or full registry path
  sizeBytes: number | null;     // measured; null when unmeasurable — never 0 as a stand-in
  confidence: LeftoverConfidence;
  reason: string;               // why it was matched — shown verbatim to the user
  selectableByDefault: boolean; // true only for confidence 'high'
}

export interface LeftoverScanResult {
  appId: string;
  appName: string;
  scanned: boolean;             // false when the scan could not run
  failureReason: string | null; // required when scanned is false
  candidates: LeftoverCandidate[];
  detectedCount: number | null; // null when scanned is false — NEVER 0
  totalBytes: number | null;
}

export interface AppUninstallResult {
  appId: string;
  success: boolean;
  leftoversCleanedCount: number;
  message: string;
  verified: boolean;
  verificationDetail: string;
  rebootRequired?: boolean;
  completed?: number;
  failed?: number;
  skipped?: number;
  reclaimableBytes?: number | null;
  failures?: ExecuteFailure[];
  backupPath?: string;
  leftovers?: LeftoverScanResult;
}

// Extension Manager
export type BrowserId = 'chrome' | 'edge' | 'brave' | 'firefox';
export type BrowserType = BrowserId;
export type ExtensionPermissionRisk = 'safe' | 'moderate' | 'high';

export interface ExtensionItem {
  id: string;
  name: string;
  version: string;
  enabled: boolean | null;
  installDate: string | null;
  browser: BrowserId;
  profilePath: string;
  description?: string | null;
  permissions?: string[];
  riskLevel?: ExtensionPermissionRisk;
}

export type BrowserExtension = ExtensionItem;

export type ExtensionPageTarget = BrowserId | { browser: BrowserId; extensionId?: string };

export interface ExtensionOpenResult {
  success: boolean;
  reason?: string;
}

export interface BrowserStatus {
  installed: boolean;
  available: boolean;
  reason?: string;
  profileCount?: number;
}

export interface ExtensionScanResult {
  extensions: ExtensionItem[];
  browsers: Record<BrowserId, BrowserStatus>;
  scannedAt: string;
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

export interface SkippedPath {
  path: string;
  reason:
    | 'permission-denied'
    | 'reparse-point-escape'
    | 'reparse-point-skipped'
    | 'not-found'
    | 'stat-error';
}

export interface DiskAnalysisResult {
  rootPath: string;
  driveTotalBytes: number | null;
  driveFreeBytes: number | null;
  scannedBytes: number;
  fileCount: number;
  directoryCount: number;
  folderTree: DiskFolderNode;
  largeFiles: LargeFileInfo[];
  breakdown: FileTypeBreakdown[];
  skippedPaths: SkippedPath[];
  scanDurationMs: number;
  complete: boolean;
}

export interface ScanProgressEvent {
  filesScanned: number;
  directoriesScanned: number;
  bytesCounted: number;
  currentPath: string;
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

export interface DuplicateScanResult {
  root: string;
  scannedFileCount: number;
  skippedCount: number;
  belowMinSizeCount: number;
  duplicateGroupCount: number;
  duplicateFileCount: number;
  wastedBytes: number;
  groups: DuplicateGroup[];
  scanDurationMs: number;
  scannedAt: string;
}

// Secure Erase
export type ShredMethodId = 'zero_1' | 'dod_3';

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

export interface ShredOptions {
  passes: number; // 1–3, default 1
  targetPaths: string[];
}

export interface WipeOptions {
  volumeRoot: string;
}

export interface ShredResult extends ExecuteResult {
  shreddedCount: number;
}

export interface WipeResult extends ExecuteResult {
  wipedBytes: number;
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

export type CustomRuleConfidence = 'user-defined';

export interface CustomRuleFile {
  path: string;
  sizeBytes: number;
}

export interface SkippedFile {
  path: string;
  reason: string;
}

export interface CustomRuleScanResult {
  ruleId: string;
  ruleName: string;
  id: string;                 // 'custom:<ruleId>' — matches the SmartCleanCategory id convention
  rootPath: string;           // fully resolved, absolute
  status: 'ok' | 'failed' | 'skipped';
  failureReason?: string;     // required when status is 'failed' or 'skipped'
  reclaimableBytes: number | null;  // null when unmeasurable — never 0 as a stand-in
  fileCount: number | null;
  files: CustomRuleFile[];    // capped, see §2.5
  skippedFiles: SkippedFile[];
  verdict: 'CONDITIONAL';     // never 'SAFE'
  source: 'user-defined rule';// never a Microsoft URL
  deletionMethod: 'recycle-bin';
  confidence: CustomRuleConfidence;
  filesTruncated?: boolean;
}

export interface CustomRuleValidationResult {
  ok: boolean;
  resolvedRoot?: string;
  reason?: string;
  warning?: string;
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

// Auto-Updater
export type UpdaterState =
  | 'idle'          // nothing attempted yet
  | 'disabled'      // autoCheckUpdates is false and no manual check in flight
  | 'unavailable'   // dev build or portable build — cannot self-update
  | 'checking'
  | 'available'     // updateVersion is known and non-null
  | 'not-available' // a check COMPLETED and reported no newer version
  | 'downloading'
  | 'downloaded'    // ready to install
  | 'error';

export interface UpdaterStatus {
  state: UpdaterState;
  currentVersion: string;          // app.getVersion()
  availableVersion: string | null; // null unless state is available/downloading/downloaded
  releaseNotes: string | null;     // null when the feed has none — never synthesised
  progressPercent: number | null;  // real from electron-updater, null when unknown
  bytesPerSecond: number | null;
  lastCheckedAt: string | null;    // ISO, only after a check actually ran
  error: string | null;            // populated ONLY in state 'error'
  message?: string | null;
}

// Scheduled Cleaning (Phase 18)
export interface ScheduledCategoryOutcome {
  id: string;
  name: string;
  status: 'cleaned' | 'failed' | 'skipped';
  reason?: string;            // why skipped/failed — required when not 'cleaned'
  reclaimedBytes: number | null;
  filesRemoved: number | null;
}

export interface ScheduledCleanReport {
  startedAt: string;
  finishedAt: string;
  trigger: 'task-scheduler' | 'manual';
  appVersion: string;
  elevated: boolean;
  skippedReason: string | null;   // set when nothing was attempted
  categories: ScheduledCategoryOutcome[];
  totals: {
    completed: number;
    failed: number;
    skipped: number;
    reclaimedBytes: number | null; // null when no category measured
  };
}

export interface ScheduledCleanState {
  registered: boolean;
  nextRun: string | null;      // real NextRunTime, null when not registered
  lastRun: string | null;
  lastResult: number | null;   // real LastTaskResult
  isPortable?: boolean;
  reason?: string;
}

export interface SetScheduledCleanResult {
  success: boolean;
  enabled: boolean;
  frequency?: 'daily' | 'weekly' | 'monthly';
  nextRun?: string | null;
  reason?: string;
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
  getHealthReport: () => Promise<HealthReport>;

  // Smart Clean
  scanSmartClean: (categoryIds?: string[]) => Promise<SmartCleanReport>;
  executeSmartClean: (categoryIds?: string[]) => Promise<ExecuteResult>;

  // Registry
  scanRegistry: () => Promise<RegistryScanResult>;
  fixRegistryIssues: (
    issueIds?: string[]
  ) => Promise<RegistryFixerResult>;
  planRegistryFix?: (
    issueIds?: string[]
  ) => Promise<OperationPlan>;
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
  getInstalledApps: (forceRefresh?: boolean) => Promise<InstalledApp[]>;
  uninstallApp: (appId: string) => Promise<AppUninstallResult>;
  planAppUninstall?: (appId: string) => Promise<OperationPlan>;
  removeAppRegistryEntry?: (appId: string) => Promise<ExecuteResult>;
  scanLeftovers: (appId: string) => Promise<LeftoverScanResult>;
  cleanLeftovers: (appId: string, candidateIds: string[]) => Promise<ExecuteResult & { leftoversCleanedCount: number }>;

  // Updater
  getUpdaterStatus: () => Promise<UpdaterStatus>;
  checkForUpdates: () => Promise<UpdaterStatus>;
  downloadUpdate: () => Promise<UpdaterStatus>;
  installUpdate: () => Promise<void>;
  onUpdaterStatus?: (callback: (status: UpdaterStatus) => void) => () => void;

  // Extensions
  getBrowserExtensions: () => Promise<ExtensionScanResult>;
  openExtensionPage: (target: ExtensionPageTarget | BrowserId) => Promise<ExtensionOpenResult>;
  rescanExtensions: () => Promise<ExtensionScanResult>;

  // Disk Analyzer
  analyzeDisk: (drivePath: string) => Promise<DiskAnalysisResult>;
  cancelDiskAnalysis?: () => Promise<{ success: boolean }>;
  onDiskScanProgress?: (callback: (progress: ScanProgressEvent) => void) => () => void;

  // Duplicate Finder
  scanDuplicates: (config: DuplicateScanConfig) => Promise<DuplicateScanResult>;
  deleteDuplicateFiles: (fileIds: string[]) => Promise<ExecuteResult>;
  planDuplicateDelete?: (fileIds?: string[]) => Promise<OperationPlan>;

  // Secure Erase
  shredItems: (
    paths: string[],
    methodId?: ShredMethodId | number,
    options?: Partial<ShredOptions>
  ) => Promise<ShredResult>;
  wipeFreeSpace: (
    driveLetter: string,
    methodId?: ShredMethodId | number,
    options?: Partial<WipeOptions>
  ) => Promise<WipeResult>;
  planShred?: (paths: string[], passes?: number) => Promise<OperationPlan>;
  planWipeFreeSpace?: (volumeRoot: string) => Promise<OperationPlan>;
  isTargetSsd?: (pathOrVolume: string) => Promise<boolean | null>;

  // Settings
  getSettings: () => Promise<AppSettings>;
  saveSettings: (settings: Partial<AppSettings>) => Promise<{ success: boolean; error?: string }>;
  validateCustomRule: (rule: CustomCleanRule) => Promise<CustomRuleValidationResult>;

  // Custom Rules
  scanCustomRules?: (rules?: CustomCleanRule[]) => Promise<CustomRuleScanResult[]>;
  planCustomRules?: (
    scanResults: CustomRuleScanResult[],
    selectedRuleIds?: string[]
  ) => Promise<OperationPlan>;

  // Scheduled Cleaning (Phase 18)
  getScheduledCleanState: () => Promise<ScheduledCleanState | null>;
  setScheduledCleanEnabled: (params: {
    enabled: boolean;
    frequency?: 'daily' | 'weekly' | 'monthly';
  }) => Promise<SetScheduledCleanResult>;
  runScheduledCleanNow?: () => Promise<{ report: ScheduledCleanReport; exitCode: number }>;
  isPortable?: () => Promise<boolean>;

  // Activity Log
  getActivityLogs: () => Promise<ActivityItem[]>;
}

declare global {
  interface Window {
    deskKleanAPI?: DeskKleanAPI;
  }
}
