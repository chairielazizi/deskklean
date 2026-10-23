import fs from 'fs';
import path from 'path';
import { runPowerShell, parseJsonSafe, isWindows } from './powershell';
import { InstalledApp, UninstallMethod } from '../../shared/types';
import { PlannedAction, OperationPlan, ExecuteResult, ExecuteFailure } from './framework/types';
import { createOperationPlan } from './framework/plan';
import { getModuleBackupDir } from './framework/backup';

export type UninstallerType =
  | 'msi'
  | 'inno'
  | 'nsis'
  | 'installshield'
  | 'wise'
  | 'store'
  | 'unknown';

export interface RawRegistryAppEntry {
  subKey: string;
  hive: 'HKLM' | 'HKCU';
  registryKey: string;
  DisplayName?: string;
  DisplayVersion?: string;
  Publisher?: string;
  InstallDate?: string;
  EstimatedSize?: number | string;
  InstallLocation?: string;
  UninstallString?: string;
  QuietUninstallString?: string;
  PSComponentID?: string;
  SystemComponent?: unknown;
  ParentKeyName?: string;
  NoModify?: unknown;
  NoRepair?: unknown;
  DisplayIcon?: string;
}

export interface RawStoreAppEntry {
  Name?: string;
  PackageFullName?: string;
  PackageFamilyName?: string;
  Version?: string;
  Publisher?: string;
  NonRemovable?: boolean;
  IsFramework?: boolean;
  InstallLocation?: string;
}

export interface ParsedCommandLine {
  executable: string;
  rawArgs: string;
  args: string[];
}

export interface ResolvedUninstallCommand {
  type: UninstallerType;
  executable: string;
  args: string[];
  isSilent: boolean;
  isInteractive: boolean;
  commandLine: string;
}

export interface ProcessInfo {
  pid: number;
  ppid: number;
  isAlive?: boolean;
}

export interface ProcessTreeWaitOptions {
  timeoutMs?: number;
  pollIntervalMs?: number;
  getProcessSnapshot?: () => Promise<ProcessInfo[]>;
  isProcessAlive?: (pid: number) => Promise<boolean>;
}

export interface ProcessTreeWaitResult {
  timedOut: boolean;
  allPids: number[];
}

export const D_AR_9_IRREVERSIBILITY_REASON =
  'Uninstalling removes the application. It can be reinstalled only by obtaining a new installer — DeskKlean does not offer a restore.';

const GUID_REGEX = /^\{?[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\}?$/;
const BRACED_GUID_REGEX = /^\{[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\}$/;

// =====================================================================
// STEP 1 & PURE LOGIC — Registry filtering, parsing, and normalization
// =====================================================================

/**
 * Checks whether an entry is flagged as a system component (D-AR-1).
 */
export function isSystemComponentEntry(val: unknown): boolean {
  if (val === 1 || val === '1' || val === true) return true;
  if (typeof val === 'number' && val === 1) return true;
  return false;
}

/**
 * Checks whether ParentKeyName is present (indicating an update/patch) (D-AR-1).
 */
export function isParentKeyPresent(val: unknown): boolean {
  return typeof val === 'string' && val.trim().length > 0;
}

/**
 * Normalizes registry InstallDate into YYYY-MM-DD format.
 */
export function normalizeInstallDate(rawDate?: string): string {
  if (!rawDate) return '';
  const trimmed = String(rawDate).trim();
  // Standard Windows registry format: YYYYMMDD
  if (/^\d{8}$/.test(trimmed)) {
    return `${trimmed.slice(0, 4)}-${trimmed.slice(4, 6)}-${trimmed.slice(6, 8)}`;
  }
  // Already ISO-like YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
    return trimmed.slice(0, 10);
  }
  return trimmed;
}

/**
 * Converts registry EstimatedSize (DWORD in KB) to bytes.
 * Absent, zero, negative, or unmeasurable values return null (never guessed!).
 */
export function convertEstimatedSize(rawSize?: unknown): number | null {
  if (rawSize === null || rawSize === undefined || rawSize === '') return null;
  const num = typeof rawSize === 'number' ? rawSize : parseInt(String(rawSize).trim(), 10);
  if (isNaN(num) || num <= 0) return null;
  return num * 1024;
}

/**
 * Resolves MSI product code from PSComponentID or subKey GUID (D-AR-2).
 */
export function resolveProductCode(
  subKey: string,
  psComponentId?: string
): { productCode: string | null; isMsi: boolean } {
  if (typeof psComponentId === 'string' && GUID_REGEX.test(psComponentId.trim())) {
    const trimmed = psComponentId.trim();
    const productCode = trimmed.startsWith('{') ? trimmed : `{${trimmed}}`;
    return { productCode, isMsi: true };
  }

  if (BRACED_GUID_REGEX.test(subKey.trim())) {
    return { productCode: subKey.trim(), isMsi: true };
  }

  return { productCode: null, isMsi: false };
}

/**
 * Splits command line argument string into tokens, preserving quoted arguments.
 */
export function tokenizeArgs(argString: string): string[] {
  const args: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < argString.length; i++) {
    const ch = argString[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
      current += ch;
    } else if (/\s/.test(ch) && !inQuotes) {
      if (current.length > 0) {
        args.push(current);
        current = '';
      }
    } else {
      current += ch;
    }
  }

  if (current.length > 0) {
    args.push(current);
  }

  return args;
}

/**
 * Parses UninstallString into executable path and arguments (Step 2).
 * Handles quoted executables, unquoted paths with spaces, and raw arguments.
 */
export function parseUninstallString(raw: string): ParsedCommandLine {
  const trimmed = (raw || '').trim();
  if (!trimmed) {
    return { executable: '', rawArgs: '', args: [] };
  }

  // Case 1: Starts with a quote
  if (trimmed.startsWith('"')) {
    const nextQuoteIdx = trimmed.indexOf('"', 1);
    if (nextQuoteIdx !== -1) {
      const executable = trimmed.slice(1, nextQuoteIdx).trim();
      const rawArgs = trimmed.slice(nextQuoteIdx + 1).trim();
      return { executable, rawArgs, args: tokenizeArgs(rawArgs) };
    }
  }

  // Case 2: No leading quote. Search for common executable extension followed by boundary or space
  const exeMatch = trimmed.match(/^(.*?\.(?:exe|bat|cmd))\b(.*)$/i);
  if (exeMatch) {
    const executable = exeMatch[1].trim();
    const rawArgs = (exeMatch[2] || '').trim();
    return { executable, rawArgs, args: tokenizeArgs(rawArgs) };
  }

  // Case 3: Space-separated fallback
  const firstSpace = trimmed.indexOf(' ');
  if (firstSpace !== -1) {
    const executable = trimmed.slice(0, firstSpace).trim();
    const rawArgs = trimmed.slice(firstSpace + 1).trim();
    return { executable, rawArgs, args: tokenizeArgs(rawArgs) };
  }

  return { executable: trimmed, rawArgs: '', args: [] };
}

/**
 * Extracts executable filename from a Windows or POSIX path.
 */
export function getExecutableBasename(p: string): string {
  if (!p) return '';
  return path.win32 ? path.win32.basename(p) : p.replace(/^.*[\\/]/, '');
}

/**
 * Detects the uninstaller framework / type from executable and command line (D-AR-3).
 */
export function detectUninstallerType(
  executable: string,
  uninstallString?: string,
  isMsi?: boolean
): UninstallerType {
  if (isMsi) return 'msi';

  const baseExe = getExecutableBasename(executable).toLowerCase();
  const fullStr = `${executable} ${uninstallString || ''}`.toLowerCase();

  // MSI detection
  if (baseExe === 'msiexec.exe' || baseExe === 'msiexec') {
    return 'msi';
  }

  // Inno Setup: unins000.exe, unins001.exe, or containing 'Inno Setup'
  if (/^unins\d{3}\.exe$/i.test(baseExe) || fullStr.includes('inno setup')) {
    return 'inno';
  }

  // Wise Installer: unwise.exe, unwise32.exe, unwise64.exe
  if (/^unwise(32|64)?\.exe$/i.test(baseExe) || fullStr.includes('wise installer')) {
    return 'wise';
  }

  // InstallShield: _isuninst.exe, isuninst.exe, or setup.exe with -uninst / -runfromtemp
  if (
    baseExe === '_isuninst.exe' ||
    baseExe === 'isuninst.exe' ||
    fullStr.includes('installshield') ||
    (baseExe === 'setup.exe' && (fullStr.includes('-uninst') || fullStr.includes('-runfromtemp')))
  ) {
    return 'installshield';
  }

  // NSIS: uninstall.exe, uninst.exe, *_uninstall.exe, or containing nsis or uppercase /S
  if (
    baseExe === 'uninstall.exe' ||
    baseExe === 'uninst.exe' ||
    baseExe.endsWith('_uninstall.exe') ||
    fullStr.includes('nsis') ||
    /\b\/S\b/.test(uninstallString || '')
  ) {
    return 'nsis';
  }

  return 'unknown';
}

/**
 * Builds the uninstaller command with silent flags when known (D-AR-2, D-AR-3).
 */
export function buildUninstallCommand(
  app: InstalledApp,
  options?: { fileExists?: (p: string) => boolean }
): ResolvedUninstallCommand {
  const checkFile = options?.fileExists ?? fs.existsSync;

  // 1. MSI Preferred (D-AR-2)
  if (app.isMsi && app.productCode) {
    return {
      type: 'msi',
      executable: 'msiexec.exe',
      args: ['/x', app.productCode, '/qn'],
      isSilent: true,
      isInteractive: false,
      commandLine: `msiexec.exe /x ${app.productCode} /qn`,
    };
  }

  // 2. Windows Store Apps (D-AR-8)
  if (app.isStoreApp || app.uninstallMethod === 'store') {
    return {
      type: 'store',
      executable: 'powershell.exe',
      args: [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        `Remove-AppxPackage -Package "${app.id}"`,
      ],
      isSilent: true,
      isInteractive: false,
      commandLine: `powershell.exe Remove-AppxPackage -Package "${app.id}"`,
    };
  }

  // 3. Unavailable / Missing target file (D-AR-7)
  if (app.uninstallMethod === 'unavailable') {
    throw new Error(
      `Uninstall unavailable for "${app.name}": uninstaller target is missing or not registered.`
    );
  }

  // 4. Non-MSI Registry UninstallString
  const rawCommand = app.quietUninstallString || app.uninstallString || '';
  const parsed = parseUninstallString(rawCommand);

  if (!parsed.executable) {
    throw new Error(`Uninstall command empty for "${app.name}".`);
  }

  // Check file exists before building command (D-AR-7)
  const isDirectSystemExe = ['msiexec', 'msiexec.exe', 'cmd.exe', 'powershell.exe'].includes(
    getExecutableBasename(parsed.executable).toLowerCase()
  );
  if (!isDirectSystemExe && !checkFile(parsed.executable)) {
    throw new Error(
      `Uninstaller target file not found on disk: "${parsed.executable}".`
    );
  }

  // If manufacturer provided QuietUninstallString, use it directly
  if (app.quietUninstallString && app.quietUninstallString.trim().length > 0) {
    const quietParsed = parseUninstallString(app.quietUninstallString);
    const type = detectUninstallerType(quietParsed.executable, app.quietUninstallString, false);
    return {
      type,
      executable: quietParsed.executable,
      args: quietParsed.args,
      isSilent: true,
      isInteractive: false,
      commandLine: app.quietUninstallString,
    };
  }

  const type = detectUninstallerType(parsed.executable, app.uninstallString || '', false);
  const args = [...parsed.args];
  const argsJoined = args.join(' ').toLowerCase();

  let isSilent = false;
  let isInteractive = false;

  switch (type) {
    case 'inno':
      if (!argsJoined.includes('/silent') && !argsJoined.includes('/verysilent')) {
        args.push('/SILENT');
      }
      isSilent = true;
      break;

    case 'nsis':
      // NSIS: /S must be uppercase and at the end
      if (!args.includes('/S')) {
        args.push('/S');
      }
      isSilent = true;
      break;

    case 'installshield':
      if (!argsJoined.includes('/s') && !argsJoined.includes('/qn')) {
        args.push('/s');
      }
      isSilent = true;
      break;

    case 'wise':
      if (!argsJoined.includes('/s')) {
        args.push('/s');
      }
      isSilent = true;
      break;

    case 'unknown':
    default:
      // Unknown uninstaller types run interactively with original flags (D-AR-5)
      isSilent = false;
      isInteractive = true;
      break;
  }

  const commandLine = args.length > 0 ? `"${parsed.executable}" ${args.join(' ')}` : `"${parsed.executable}"`;

  return {
    type,
    executable: parsed.executable,
    args,
    isSilent,
    isInteractive,
    commandLine,
  };
}

/**
 * Filters and maps a raw registry entry into an InstalledApp object (D-AR-1).
 * Returns null if the entry should be excluded.
 */
export function filterAndMapRegistryEntry(
  entry: RawRegistryAppEntry,
  options?: { fileExists?: (p: string) => boolean }
): InstalledApp | null {
  // Exclusion 1: Entries with no DisplayName (D-AR-1)
  if (!entry.DisplayName || !entry.DisplayName.trim()) {
    return null;
  }

  // Exclusion 2: System components (SystemComponent = 1) (D-AR-1)
  if (isSystemComponentEntry(entry.SystemComponent)) {
    return null;
  }

  // Exclusion 3: Updates and patches (ParentKeyName present) (D-AR-1)
  if (isParentKeyPresent(entry.ParentKeyName)) {
    return null;
  }

  const checkFile = options?.fileExists ?? fs.existsSync;
  const { productCode, isMsi } = resolveProductCode(entry.subKey, entry.PSComponentID);

  // Compute uninstallMethod (D-AR-1, D-AR-7)
  let uninstallMethod: UninstallMethod = 'unavailable';

  if (isMsi) {
    uninstallMethod = 'msi';
  } else {
    const rawCmd = entry.QuietUninstallString || entry.UninstallString;
    if (rawCmd && rawCmd.trim().length > 0) {
      const parsed = parseUninstallString(rawCmd);
      const isSystemExe = ['msiexec', 'msiexec.exe', 'cmd.exe', 'powershell.exe'].includes(
        getExecutableBasename(parsed.executable).toLowerCase()
      );
      if (parsed.executable && (isSystemExe || checkFile(parsed.executable))) {
        uninstallMethod = 'uninstall-string';
      } else {
        uninstallMethod = 'unavailable';
      }
    } else {
      uninstallMethod = 'unavailable';
    }
  }

  return {
    id: entry.subKey,
    name: entry.DisplayName.trim(),
    publisher: entry.Publisher ? entry.Publisher.trim() : '',
    version: entry.DisplayVersion ? entry.DisplayVersion.trim() : '',
    installDate: normalizeInstallDate(entry.InstallDate),
    sizeBytes: convertEstimatedSize(entry.EstimatedSize),
    installLocation: entry.InstallLocation ? entry.InstallLocation.trim() : '',
    uninstallString: entry.UninstallString ? entry.UninstallString.trim() : null,
    quietUninstallString: entry.QuietUninstallString ? entry.QuietUninstallString.trim() : null,
    productCode,
    isMsi,
    isStoreApp: false,
    uninstallMethod,
    leftoversDetected: null,
    isSystemComponent: false,
    hive: entry.hive,
    keyPath: entry.registryKey,
    registryKey: `${entry.hive}\\${entry.registryKey}`,
  };
}

/**
 * Maps a raw Store app (MSIX / UWP) entry into an InstalledApp object (D-AR-8).
 */
export function filterAndMapStoreEntry(entry: RawStoreAppEntry): InstalledApp | null {
  if (!entry.PackageFullName || !entry.Name) {
    return null;
  }

  return {
    id: entry.PackageFullName,
    name: entry.Name,
    publisher: entry.Publisher || '',
    version: entry.Version || '',
    installDate: '',
    sizeBytes: null, // Store apps don't register EstimatedSize in registry
    installLocation: entry.InstallLocation || '',
    uninstallString: null,
    quietUninstallString: null,
    productCode: null,
    isMsi: false,
    isStoreApp: true,
    uninstallMethod: 'store',
    leftoversDetected: null,
    isSystemComponent: false,
    packageFamilyName: entry.PackageFamilyName,
    nonRemovable: entry.NonRemovable === true || entry.IsFramework === true,
  };
}

// =====================================================================
// STEP 1 & 5 — Enumeration via PowerShell (Batched into ONE call)
// =====================================================================

/**
 * Enumerates all desktop installed applications from the three Uninstall keys in ONE batched PowerShell call (Step 1).
 */
export async function enumerateRegistryApps(options?: {
  runPowerShellFn?: (s: string) => Promise<string>;
  fileExists?: (p: string) => boolean;
}): Promise<InstalledApp[]> {
  const runner = options?.runPowerShellFn ?? runPowerShell;

  const script = `
    $roots = @(
      'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
      'HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
      'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall'
    );
    $items = @();
    foreach ($root in $roots) {
      if (Test-Path -LiteralPath $root) {
        $hive = if ($root -like 'HKCU*') { 'HKCU' } else { 'HKLM' };
        Get-ChildItem -LiteralPath $root -ErrorAction SilentlyContinue | ForEach-Object {
          $props = Get-ItemProperty -LiteralPath $_.PSPath -ErrorAction SilentlyContinue;
          if ($null -ne $props) {
            $name = [string]$props.DisplayName;
            if (-not [string]::IsNullOrWhiteSpace($name)) {
              $items += [PSCustomObject]@{
                subKey = $_.PSChildName;
                hive = $hive;
                registryKey = ($_.PSPath -replace '^[A-Za-z]+::', '');
                DisplayName = $name;
                DisplayVersion = [string]$props.DisplayVersion;
                Publisher = [string]$props.Publisher;
                InstallDate = [string]$props.InstallDate;
                EstimatedSize = $props.EstimatedSize;
                InstallLocation = [string]$props.InstallLocation;
                UninstallString = [string]$props.UninstallString;
                QuietUninstallString = [string]$props.QuietUninstallString;
                PSComponentID = [string]$props.PSComponentID;
                SystemComponent = $props.SystemComponent;
                ParentKeyName = [string]$props.ParentKeyName;
                NoModify = $props.NoModify;
                NoRepair = $props.NoRepair;
                DisplayIcon = [string]$props.DisplayIcon;
              };
            }
          }
        };
      }
    }
    if ($items.Count -gt 0) {
      $items | ConvertTo-Json -Depth 3 -Compress
    } else {
      '[]'
    }
  `.trim();

  try {
    const raw = await runner(script);
    const parsed = parseJsonSafe<unknown>(raw, [], 'appRemover:enumerateRegistryApps');
    const rawList = Array.isArray(parsed) ? (parsed as RawRegistryAppEntry[]) : parsed ? [parsed as RawRegistryAppEntry] : [];

    const result: InstalledApp[] = [];
    const seenIds = new Set<string>();

    for (const rawEntry of rawList) {
      const app = filterAndMapRegistryEntry(rawEntry, options);
      if (app && !seenIds.has(app.id)) {
        seenIds.add(app.id);
        result.push(app);
      }
    }

    return result;
  } catch (err) {
    console.warn('Failed to enumerate registry apps:', err);
    return [];
  }
}

/**
 * Enumerates Windows Store (UWP / MSIX) apps via Get-AppxPackage (Step 5, D-AR-8).
 */
export async function enumerateStoreApps(options?: {
  runPowerShellFn?: (s: string) => Promise<string>;
}): Promise<InstalledApp[]> {
  const runner = options?.runPowerShellFn ?? runPowerShell;

  const script = `
    Get-AppxPackage -AllUsers:$false -ErrorAction SilentlyContinue |
      Select-Object Name, PackageFullName, PackageFamilyName, Version, Publisher, NonRemovable, IsFramework, InstallLocation |
      ConvertTo-Json -Depth 3 -Compress
  `.trim();

  try {
    const raw = await runner(script);
    const parsed = parseJsonSafe<unknown>(raw, [], 'appRemover:enumerateStoreApps');
    const rawList = Array.isArray(parsed) ? (parsed as RawStoreAppEntry[]) : parsed ? [parsed as RawStoreAppEntry] : [];

    const result: InstalledApp[] = [];
    for (const item of rawList) {
      const mapped = filterAndMapStoreEntry(item);
      if (mapped) {
        result.push(mapped);
      }
    }
    return result;
  } catch (err) {
    console.warn('Failed to enumerate Store apps:', err);
    return [];
  }
}

// In-memory cache for installed apps enumeration (2-minute TTL)
let appCache: {
  timestamp: number;
  apps: InstalledApp[];
} | null = null;

const APP_CACHE_TTL_MS = 120_000;

export function invalidateAppCache(): void {
  appCache = null;
}

/**
 * Combined enumeration: reads registry apps and store apps.
 * Caches results in-memory for 2 minutes unless forceRefresh is true.
 */
export async function getAllInstalledApps(options?: {
  runPowerShellFn?: (s: string) => Promise<string>;
  fileExists?: (p: string) => boolean;
  forceRefresh?: boolean;
}): Promise<InstalledApp[]> {
  const isDefaultRunners = !options?.runPowerShellFn && !options?.fileExists;

  if (
    isDefaultRunners &&
    !options?.forceRefresh &&
    appCache &&
    Date.now() - appCache.timestamp < APP_CACHE_TTL_MS
  ) {
    return appCache.apps;
  }

  const [registryApps, storeApps] = await Promise.all([
    enumerateRegistryApps(options).catch(() => []),
    enumerateStoreApps(options).catch(() => []),
  ]);
  const result = [...registryApps, ...storeApps];

  if (isDefaultRunners && result.length > 0) {
    appCache = {
      timestamp: Date.now(),
      apps: result,
    };
  }

  return result;
}

// =====================================================================
// STEP 3 — Framework Plan Construction (Irreversibility & Rails)
// =====================================================================

/**
 * Creates an OperationPlan for uninstalling an application (Step 3).
 * Enforces Phase 3 rails:
 * - reversibility: 'irreversible' with D-AR-9 reason
 * - requiresElevation: true
 * - reclaimableBytes: registry EstimatedSize (estimate, labelled as such)
 * - Blocked entries reported when uninstaller executable is missing (D-AR-7) or system package
 */
export function createAppUninstallPlan(
  app: InstalledApp,
  options?: { fileExists?: (p: string) => boolean }
): OperationPlan {
  // If app is non-removable system package: block
  if (app.nonRemovable) {
    return createOperationPlan({
      module: 'app-remover',
      actions: [],
      blocked: [
        {
          target: app.id,
          reason: `Protected Windows system package cannot be removed: "${app.name}".`,
        },
      ],
      reversibility: 'irreversible',
      irreversibilityReason: D_AR_9_IRREVERSIBILITY_REASON,
      requiresElevation: true,
    });
  }

  // If uninstaller target is missing: block from uninstallation (D-AR-7)
  if (app.uninstallMethod === 'unavailable') {
    return createOperationPlan({
      module: 'app-remover',
      actions: [],
      blocked: [
        {
          target: app.id,
          reason: `Uninstall unavailable — installer not found: "${app.name}".`,
        },
      ],
      reversibility: 'irreversible',
      irreversibilityReason: D_AR_9_IRREVERSIBILITY_REASON,
      requiresElevation: true,
    });
  }

  const cmd = buildUninstallCommand(app, options);

  const action: PlannedAction = {
    id: `uninstall-${app.id}`,
    kind: 'uninstall',
    target: app.isMsi ? (app.productCode || app.id) : (app.isStoreApp ? app.id : cmd.executable),
    description: `Uninstall ${app.name}${app.version ? ` (v${app.version})` : ''}`,
    reclaimableBytes: app.sizeBytes, // Registry EstimatedSize — an estimate
    metadata: {
      appId: app.id,
      appName: app.name,
      version: app.version,
      uninstallMethod: app.uninstallMethod,
      productCode: app.productCode,
      isMsi: app.isMsi,
      isStoreApp: app.isStoreApp,
      executable: cmd.executable,
      args: cmd.args,
      commandLine: cmd.commandLine,
      isSilent: cmd.isSilent,
      isInteractive: cmd.isInteractive,
      uninstallerType: cmd.type,
      hive: app.hive,
      keyPath: app.keyPath,
      registryKey: app.registryKey,
    },
  };

  return createOperationPlan({
    module: 'app-remover',
    actions: [action],
    blocked: [],
    reversibility: 'irreversible',
    irreversibilityReason: D_AR_9_IRREVERSIBILITY_REASON,
    requiresElevation: true,
  });
}

/**
 * Creates an OperationPlan to remove a registry entry only (D-AR-7).
 * Binding Rail 5: The UI and plan must state plainly that the application remains installed.
 */
export function createRemoveAppRegistryEntryPlan(app: InstalledApp): OperationPlan {
  if (!app.registryKey) {
    throw new Error('Cannot remove registry entry: registryKey path is missing.');
  }

  const action: PlannedAction = {
    id: `remove-reg-${app.id}`,
    kind: 'registry-key',
    target: app.registryKey,
    description: `Remove registry entry for "${app.name}". Application remains installed on the machine.`,
    reclaimableBytes: null,
    metadata: {
      hive: app.hive || 'HKLM',
      keyPath: app.keyPath || app.id,
      appId: app.id,
      removeEntryOnly: true,
    },
  };

  return createOperationPlan({
    module: 'app-remover',
    actions: [action],
    blocked: [],
    reversibility: 'reversible',
    requiresElevation: app.hive === 'HKLM',
  });
}

// =====================================================================
// STEP 4 — Process-Tree Wait Strategy & Verification Logic
// =====================================================================

/**
 * Waits for a process and all its child / descendant processes to exit (OQ-AR-4, Step 4).
 * A primary-only wait fails when uninstallers (e.g. Inno Setup) spawn a worker and exit.
 */
export async function waitForProcessTree(
  rootPid: number,
  options?: ProcessTreeWaitOptions
): Promise<ProcessTreeWaitResult> {
  const timeoutMs = options?.timeoutMs ?? 60000;
  const pollIntervalMs = options?.pollIntervalMs ?? 500;
  const deadline = Date.now() + timeoutMs;

  const trackedPids = new Set<number>([rootPid]);

  // Default snapshot provider on Windows using CIM Win32_Process
  const getSnapshot =
    options?.getProcessSnapshot ??
    (async (): Promise<ProcessInfo[]> => {
      try {
        const raw = await runPowerShell(
          'Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Select-Object ProcessId, ParentProcessId | ConvertTo-Json -Compress',
          { timeoutMs: 5000 }
        );
        const parsed = parseJsonSafe<any[]>(raw, [], 'waitForProcessTree:snapshot');
        const list = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
        return list.map((item) => ({
          pid: Number(item?.ProcessId),
          ppid: Number(item?.ParentProcessId),
        }));
      } catch {
        return [];
      }
    });

  const checkAlive =
    options?.isProcessAlive ??
    (async (pid: number): Promise<boolean> => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    });

  while (Date.now() < deadline) {
    // 1. Query process list to discover newly spawned children
    let snapshot: ProcessInfo[] = [];
    let snapshotSuccess = false;
    try {
      snapshot = await getSnapshot();
      snapshotSuccess = true;
    } catch {
      snapshot = [];
      snapshotSuccess = false;
    }

    // 2. Discover all children belonging to any currently tracked PID
    let discoveredNew = false;
    for (const proc of snapshot) {
      if (trackedPids.has(proc.ppid) && !trackedPids.has(proc.pid)) {
        trackedPids.add(proc.pid);
        discoveredNew = true;
      }
    }

    // 3. Check if ANY tracked PID is still alive
    let anyAlive = false;
    for (const pid of trackedPids) {
      const matchInSnapshot = snapshot.find((s) => s.pid === pid);
      if (matchInSnapshot) {
        if (matchInSnapshot.isAlive !== undefined) {
          if (matchInSnapshot.isAlive) {
            anyAlive = true;
            break;
          }
        } else {
          anyAlive = true;
          break;
        }
      } else if (!snapshotSuccess) {
        // Only fall back to individual process check when the full snapshot query failed
        const alive = await checkAlive(pid);
        if (alive) {
          anyAlive = true;
          break;
        }
      }
    }

    // If none are alive, the entire process tree has terminated!
    if (!anyAlive) {
      return { timedOut: false, allPids: Array.from(trackedPids) };
    }

    // Wait poll interval before checking again
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  return { timedOut: true, allPids: Array.from(trackedPids) };
}

/**
 * Checks whether Windows has reboot-deferred deletions pending (D-AR-6).
 * Reads HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\PendingFileRenameOperations.
 */
export async function checkPendingReboot(options?: {
  runPowerShellFn?: (s: string) => Promise<string>;
}): Promise<boolean> {
  const runner = options?.runPowerShellFn ?? runPowerShell;
  const script = `
    $p = 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Session Manager';
    if (Test-Path -LiteralPath $p) {
      $val = (Get-ItemProperty -LiteralPath $p -Name 'PendingFileRenameOperations' -ErrorAction SilentlyContinue).PendingFileRenameOperations;
      if ($null -ne $val -and $val.Length -gt 0) { 'true' } else { 'false' }
    } else {
      'false'
    }
  `.trim();

  try {
    const raw = await runner(script);
    return raw.trim().toLowerCase() === 'true';
  } catch {
    return false;
  }
}

/**
 * Verifies removal by checking re-enumerated app list (D-AR-4).
 * Success is ONLY reported when the product is no longer present.
 */
export function verifyAppRemoved(
  appId: string,
  reEnumeratedApps: InstalledApp[],
  productCode?: string | null
): { removed: boolean; remainingApp?: InstalledApp } {
  const found = reEnumeratedApps.find((a) => {
    if (a.id.toLowerCase() === appId.toLowerCase()) return true;
    if (productCode && a.productCode && a.productCode.toLowerCase() === productCode.toLowerCase()) {
      return true;
    }
    return false;
  });

  return {
    removed: !found,
    remainingApp: found,
  };
}
