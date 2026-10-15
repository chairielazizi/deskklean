import { AppSettings, ShredMethod, CleanSubcategory } from './types';

export const APP_NAME = 'DeskKlean';
export const APP_VERSION = '1.0.0';
export const APP_AUTHOR = 'DeskKlean Team';

export const IPC_CHANNELS = {
  // App / Elevation
  APP_IS_ELEVATED: 'app:isElevated',
  APP_RELAUNCH_ELEVATED: 'app:relaunchElevated',

  // Window
  WINDOW_MINIMIZE: 'window:minimize',
  WINDOW_MAXIMIZE: 'window:maximize',
  WINDOW_CLOSE: 'window:close',
  WINDOW_IS_MAXIMIZED: 'window:isMaximized',

  // System
  SYSTEM_GET_SPECS: 'system:getSpecs',
  SYSTEM_GET_TELEMETRY: 'system:getTelemetry',

  // Health Check
  HEALTH_SCAN: 'health:scan',
  HEALTH_FIX: 'health:fix',

  // Smart Clean
  SMART_CLEAN_SCAN: 'smartClean:scan',
  SMART_CLEAN_EXECUTE: 'smartClean:execute',

  // Registry
  REGISTRY_SCAN: 'registry:scan',
  REGISTRY_FIX: 'registry:fix',
  REGISTRY_GET_BACKUPS: 'registry:getBackups',
  REGISTRY_RESTORE_BACKUP: 'registry:restoreBackup',

  // Startup
  STARTUP_GET_ITEMS: 'startup:getItems',
  STARTUP_TOGGLE_ITEM: 'startup:toggleItem',
  STARTUP_SET_DELAY: 'startup:setDelay',

  // Apps
  APPS_GET_INSTALLED: 'apps:getInstalled',
  APPS_UNINSTALL: 'apps:uninstall',

  // Extensions
  EXTENSIONS_GET: 'extensions:get',
  EXTENSIONS_TOGGLE: 'extensions:toggle',
  EXTENSIONS_REMOVE: 'extensions:remove',

  // Disk Analyzer
  DISK_ANALYZE: 'disk:analyze',

  // Duplicate Finder
  DUPLICATES_SCAN: 'duplicates:scan',
  DUPLICATES_DELETE: 'duplicates:delete',

  // Secure Erase
  SHRED_ITEMS: 'shred:items',
  WIPE_FREE_SPACE: 'shred:wipeFreeSpace',

  // Settings
  SETTINGS_GET: 'settings:get',
  SETTINGS_SAVE: 'settings:save',

  // Activity Logs
  LOGS_GET: 'logs:get',
} as const;

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'cyber-slate',
  accentColor: 'emerald',
  autoCheckUpdates: true,
  minimizeToTray: true,
  closeToTray: false,
  runAtStartup: false,
  confirmBeforeDelete: true,
  autoRegistryBackup: true,
  bypassRecycleBinWarning: false,
  excludedPaths: [
    'C:\\Windows\\System32\\drivers',
    'C:\\Program Files\\Windows Defender',
  ],
  customRules: [],
  scheduledCleanEnabled: false,
  scheduledCleanFrequency: 'weekly',
  elevationPromptDismissed: false,
};

export const SHRED_METHODS: ShredMethod[] = [
  {
    id: 'zero_1',
    name: 'Quick Zero-Fill',
    passes: 1,
    description: 'Overwrites target data with zeros in a single pass. Fast and suitable for non-sensitive data.',
    compliance: 'Standard Erasure',
  },
  {
    id: 'dod_3',
    name: 'DoD 5220.22-M',
    passes: 3,
    description: 'US Department of Defense standard: Overwrites with 0s, 1s, and pseudo-random bytes with verification.',
    compliance: 'DoD 5220.22-M Compliant',
  },
  {
    id: 'dod_7',
    name: 'NSA / DoD ECE 7-Pass',
    passes: 7,
    description: 'High security 7-pass overwrite standard recommended for military grade data sanitization.',
    compliance: 'NSA 130-1 / DoD 5220.22-M ECE',
  },
  {
    id: 'gutmann_35',
    name: 'Peter Gutmann Method',
    passes: 35,
    description: 'Maximum theoretical security: 35 passes of magnetic domain randomization patterns.',
    compliance: 'Peter Gutmann (1996) Specification',
  },
];

export const DEFAULT_CLEAN_CATEGORIES: CleanSubcategory[] = [
  // Windows
  {
    id: 'win_temp',
    name: 'Temporary Files',
    category: 'windows',
    description: 'Windows temp directory, user temp folder, and update leftovers',
    enabled: true,
    itemCount: 1420,
    sizeBytes: 2548200000, // ~2.5 GB
  },
  {
    id: 'win_recycle',
    name: 'Recycle Bin',
    category: 'windows',
    description: 'Deleted items awaiting permanent removal',
    enabled: true,
    itemCount: 312,
    sizeBytes: 1845000000, // ~1.8 GB
  },
  {
    id: 'win_memory_dumps',
    name: 'Memory Dumps & Error Reports',
    category: 'windows',
    description: 'Crash dumps (MEMORY.DMP), minidumps, and WER crash reporting logs',
    enabled: true,
    itemCount: 48,
    sizeBytes: 840000000, // ~840 MB
  },
  {
    id: 'win_dns_cache',
    name: 'DNS Resolver Cache',
    category: 'windows',
    description: 'Local DNS name resolution lookup cache',
    enabled: true,
    itemCount: 124,
    sizeBytes: 154000,
  },
  {
    id: 'win_thumbnails',
    name: 'Thumbnail Cache',
    category: 'windows',
    description: 'Windows Explorer cached icon and preview images (thumbcache_*.db)',
    enabled: true,
    itemCount: 18,
    sizeBytes: 420000000, // ~420 MB
  },
  {
    id: 'win_logs',
    name: 'Windows System Event Logs',
    category: 'windows',
    description: 'Outdated diagnostic and install logs from CBS, DISM, and Setup',
    enabled: false,
    itemCount: 65,
    sizeBytes: 215000000,
  },

  // Browsers
  {
    id: 'browser_chrome_cache',
    name: 'Google Chrome - Cache & GPU Cache',
    category: 'browser',
    description: 'Cached web pages, images, and script assets',
    enabled: true,
    itemCount: 3820,
    sizeBytes: 1280000000, // ~1.28 GB
  },
  {
    id: 'browser_chrome_cookies',
    name: 'Google Chrome - Tracking Cookies',
    category: 'browser',
    description: 'Third-party tracking cookies and site storage',
    enabled: true,
    itemCount: 640,
    sizeBytes: 4200000,
  },
  {
    id: 'browser_edge_cache',
    name: 'Microsoft Edge - Cache & History',
    category: 'browser',
    description: 'Edge browsing cache, web storage, and session records',
    enabled: true,
    itemCount: 1940,
    sizeBytes: 670000000,
  },
  {
    id: 'browser_firefox_cache',
    name: 'Mozilla Firefox - Web Cache',
    category: 'browser',
    description: 'Firefox startup cache, offline storage, and site cookies',
    enabled: true,
    itemCount: 890,
    sizeBytes: 310000000,
  },

  // Applications
  {
    id: 'app_vscode',
    name: 'Visual Studio Code - Workspace Cache',
    category: 'application',
    description: 'Code cached extensions, GPU cache, and backup telemetry',
    enabled: true,
    itemCount: 520,
    sizeBytes: 480000000,
  },
  {
    id: 'app_discord',
    name: 'Discord - Media & GPU Cache',
    category: 'application',
    description: 'Cached media previews, voice caches, and voice clip storage',
    enabled: true,
    itemCount: 1850,
    sizeBytes: 890000000,
  },
  {
    id: 'app_spotify',
    name: 'Spotify - Offline Song Previews',
    category: 'application',
    description: 'Local streaming song chunk cache',
    enabled: true,
    itemCount: 410,
    sizeBytes: 620000000,
  },
  {
    id: 'app_node_npm',
    name: 'Node / npm Cache',
    category: 'application',
    description: 'Cached tarballs in npm-cache',
    enabled: false,
    itemCount: 1100,
    sizeBytes: 1450000000,
  },
];
