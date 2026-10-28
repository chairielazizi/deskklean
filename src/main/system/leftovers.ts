import path from 'path';
import fs from 'fs';
import {
  InstalledApp,
  LeftoverCandidate,
  LeftoverConfidence,
  LeftoverScanResult,
  OperationPlan,
  PlannedAction,
  BlockedAction,
  Reversibility,
} from '../../shared/types';
import {
  validatePath,
  validateRegistryPath,
  normalizePathForComparison,
  resolvePathCrossPlatform,
  getSystemPaths,
} from './framework/protected';
import { createOperationPlan } from './framework/plan';
import { keyExists } from './registry';

export interface CandidateBuildOptions {
  existingEntries?: string[];
  existingFiles?: string[];
  existingRegistryKeys?: string[];
}

export interface CandidateFilterOptions {
  env?: NodeJS.ProcessEnv;
  currentAppId?: string;
}

export interface LeftoverScanOptions {
  env?: NodeJS.ProcessEnv;
  installedApps?: InstalledApp[];
  requireVerified?: boolean;
  statFn?: (p: string) => Promise<{ isDirectory(): boolean; isFile(): boolean; size: number } | null>;
  measureDirSizeFn?: (p: string) => Promise<number | null>;
  keyExistsFn?: (hive: string, keyPath: string) => Promise<boolean>;
  readdirFn?: (p: string) => Promise<string[]>;
  readRegistrySubKeysFn?: (hive: string, keyPath: string) => Promise<string[]>;
  forceFailure?: boolean;
}

export interface LeftoverPlanOptions {
  planId?: string;
}

/**
 * Normalizes an application token (name or publisher) for safe matching.
 * Pure function:
 * - Lowercase, trim, collapse whitespace
 * - Strip (x86), (x64), 32-bit, 64-bit tags
 * - Strip trailing version tokens (e.g. 1.2.3, v2.0, 2024)
 * - Strip trailing company suffixes (Ltd, Inc, LLC, Sdn Bhd, Corp, Corporation, GmbH, Co, Company, etc.)
 */
export function normalizeAppToken(s: string): string {
  if (typeof s !== 'string') return '';
  let token = s.toLowerCase().trim();

  // Collapse whitespace
  token = token.replace(/\s+/g, ' ');

  // Strip (x86), (x64), [x86], (64-bit), (32-bit), etc.
  token = token.replace(/\s*[\(\[](?:x86|x64|64-bit|32-bit)[\)\]]/gi, '').trim();

  let prev = '';
  while (prev !== token) {
    prev = token;

    // Strip trailing version tokens like v1.2.3, 1.0, 2024, 115.0esr, -1.0.0, etc.
    token = token.replace(/(?:[\s._-]+v?\d+(?:\.\d+)*(?:[a-z0-9_-]+)?)+$/i, '').trim();

    // Strip trailing company/entity suffixes
    token = token
      .replace(
        /[\s,.-]+(?:sdn\s+bhd|pty\s+ltd|ltd|inc|llc|corp|corporation|gmbh|co|company|b\.v|ag|se|s\.a)\.?$/i,
        ''
      )
      .trim();

    // Strip trailing punctuation
    token = token.replace(/[\s,.-]+$/, '').trim();
  }

  return token.replace(/\s+/g, ' ').trim();
}

/**
 * Returns the five environment roots used for candidate scanning.
 */
export function getEnvRoots(env: NodeJS.ProcessEnv = process.env): {
  localAppData: string;
  appData: string;
  programData: string;
  localPrograms: string;
  programFiles: string;
  programFilesX86?: string;
} {
  const sys = getSystemPaths();
  const localAppData =
    env.LOCALAPPDATA ||
    (env.USERPROFILE
      ? path.join(env.USERPROFILE, 'AppData', 'Local')
      : path.join(sys.userProfile, 'AppData', 'Local'));
  const appData =
    env.APPDATA ||
    (env.USERPROFILE
      ? path.join(env.USERPROFILE, 'AppData', 'Roaming')
      : path.join(sys.userProfile, 'AppData', 'Roaming'));
  const programData = env.ProgramData || env.PROGRAMDATA || sys.programData;
  const localPrograms = path.join(localAppData, 'Programs');
  const programFiles = env.ProgramFiles || env.PROGRAMFILES || sys.programFiles;
  const programFilesX86 = env['ProgramFiles(x86)'] || sys.programFilesX86;

  return {
    localAppData,
    appData,
    programData,
    localPrograms,
    programFiles,
    programFilesX86,
  };
}

/**
 * Generates candidate leftover paths for an application.
 * Pure candidate-path generation from the app record + env.
 * No filesystem access — testable on Linux.
 */
export function buildLeftoverCandidates(
  app: InstalledApp,
  env: NodeJS.ProcessEnv = process.env,
  opts?: CandidateBuildOptions
): LeftoverCandidate[] {
  if (!app || typeof app !== 'object') return [];

  const nameToken = normalizeAppToken(app.name);
  // §2.3 item 5: Empty match — a normalized name shorter than 3 characters produces no candidates at all
  if (nameToken.length < 3) {
    return [];
  }

  const publisherToken = app.publisher ? normalizeAppToken(app.publisher) : '';
  const roots = getEnvRoots(env);
  const candidates: LeftoverCandidate[] = [];
  const seenPaths = new Set<string>();

  const addCandidate = (cand: LeftoverCandidate) => {
    const norm = cand.path.toLowerCase().replace(/\\/g, '/');
    if (!seenPaths.has(norm)) {
      seenPaths.add(norm);
      candidates.push(cand);
    }
  };

  // 1. Install directory remnant (high confidence)
  if (app.installLocation && typeof app.installLocation === 'string' && app.installLocation.trim()) {
    addCandidate({
      id: `leftover-installdir-${candidates.length + 1}`,
      kind: 'directory',
      path: resolvePathCrossPlatform(app.installLocation.trim()),
      sizeBytes: null,
      confidence: 'high',
      reason: 'Install directory remnant',
      selectableByDefault: true,
    });
  }

  // 2. The five env roots exact matches (high confidence)
  // %LOCALAPPDATA%\<Name>
  addCandidate({
    id: `leftover-localappdata-${candidates.length + 1}`,
    kind: 'directory',
    path: path.join(roots.localAppData, app.name),
    sizeBytes: null,
    confidence: 'high',
    reason: 'Exact match in %LOCALAPPDATA%',
    selectableByDefault: true,
  });

  // %APPDATA%\<Name>
  addCandidate({
    id: `leftover-appdata-${candidates.length + 1}`,
    kind: 'directory',
    path: path.join(roots.appData, app.name),
    sizeBytes: null,
    confidence: 'high',
    reason: 'Exact match in %APPDATA%',
    selectableByDefault: true,
  });

  // %PROGRAMDATA%\<Name>
  addCandidate({
    id: `leftover-programdata-${candidates.length + 1}`,
    kind: 'directory',
    path: path.join(roots.programData, app.name),
    sizeBytes: null,
    confidence: 'high',
    reason: 'Exact match in %PROGRAMDATA%',
    selectableByDefault: true,
  });

  // %LOCALAPPDATA%\Programs\<Name>
  addCandidate({
    id: `leftover-programs-${candidates.length + 1}`,
    kind: 'directory',
    path: path.join(roots.localPrograms, app.name),
    sizeBytes: null,
    confidence: 'high',
    reason: 'Exact match in %LOCALAPPDATA%\\Programs',
    selectableByDefault: true,
  });

  // %PROGRAMFILES%\<Name>
  addCandidate({
    id: `leftover-programfiles-${candidates.length + 1}`,
    kind: 'directory',
    path: path.join(roots.programFiles, app.name),
    sizeBytes: null,
    confidence: 'high',
    reason: 'Exact match in %PROGRAMFILES%',
    selectableByDefault: true,
  });

  // Also check publisher exact matches if distinct and valid
  if (publisherToken.length >= 3 && publisherToken !== nameToken && app.publisher) {
    addCandidate({
      id: `leftover-pub-localappdata-${candidates.length + 1}`,
      kind: 'directory',
      path: path.join(roots.localAppData, app.publisher),
      sizeBytes: null,
      confidence: 'high',
      reason: `Exact match for publisher "${app.publisher}" in %LOCALAPPDATA%`,
      selectableByDefault: true,
    });
    addCandidate({
      id: `leftover-pub-appdata-${candidates.length + 1}`,
      kind: 'directory',
      path: path.join(roots.appData, app.publisher),
      sizeBytes: null,
      confidence: 'high',
      reason: `Exact match for publisher "${app.publisher}" in %APPDATA%`,
      selectableByDefault: true,
    });
    addCandidate({
      id: `leftover-pub-programdata-${candidates.length + 1}`,
      kind: 'directory',
      path: path.join(roots.programData, app.publisher),
      sizeBytes: null,
      confidence: 'high',
      reason: `Exact match for publisher "${app.publisher}" in %PROGRAMDATA%`,
      selectableByDefault: true,
    });
  }

  // Store apps MSIX exact packages directory (OQ-LO-1)
  if (app.packageFamilyName) {
    addCandidate({
      id: `leftover-package-${candidates.length + 1}`,
      kind: 'directory',
      path: path.join(roots.localAppData, 'Packages', app.packageFamilyName),
      sizeBytes: null,
      confidence: 'high',
      reason: 'Store app package data directory in %LOCALAPPDATA%\\Packages',
      selectableByDefault: true,
    });
  }

  // 3. Three Registry roots exact matches (high confidence)
  // HKCU\Software\<Name>
  addCandidate({
    id: `leftover-reg-hkcu-${candidates.length + 1}`,
    kind: 'registry-key',
    path: `HKCU\\Software\\${app.name}`,
    sizeBytes: null,
    confidence: 'high',
    reason: 'Exact match in HKCU\\Software',
    selectableByDefault: true,
  });

  // HKLM\Software\<Name>
  addCandidate({
    id: `leftover-reg-hklm-${candidates.length + 1}`,
    kind: 'registry-key',
    path: `HKLM\\Software\\${app.name}`,
    sizeBytes: null,
    confidence: 'high',
    reason: 'Exact match in HKLM\\Software',
    selectableByDefault: true,
  });

  // HKLM\Software\WOW6432Node\<Name>
  addCandidate({
    id: `leftover-reg-wow64-${candidates.length + 1}`,
    kind: 'registry-key',
    path: `HKLM\\Software\\WOW6432Node\\${app.name}`,
    sizeBytes: null,
    confidence: 'high',
    reason: 'Exact match in HKLM\\Software\\WOW6432Node',
    selectableByDefault: true,
  });

  // Check substring / contains matches if test mock or scanned entries provided
  const candidateEntries = [
    ...(opts?.existingEntries || []),
    ...(opts?.existingFiles || []),
    ...(opts?.existingRegistryKeys || []),
  ];

  for (const entry of candidateEntries) {
    const isRegistry = /^HK(CU|LM|CR|U)\\/i.test(entry);
    const basename = path.basename(entry.replace(/\\/g, '/'));
    const normBase = normalizeAppToken(basename);

    // Exact match already handled
    if (normBase === nameToken || (publisherToken && normBase === publisherToken)) {
      continue;
    }

    // Substring match: nameToken contained in entry basename
    if (normBase.includes(nameToken) || basename.toLowerCase().includes(nameToken)) {
      addCandidate({
        id: `leftover-sub-${candidates.length + 1}`,
        kind: isRegistry ? 'registry-key' : 'directory',
        path: entry,
        sizeBytes: null,
        confidence: 'medium',
        reason: `Contains "${nameToken}" in name (${basename})`,
        selectableByDefault: false,
      });
    }
  }

  return candidates;
}

/**
 * Applies the 5 mandatory exclusions to candidate leftovers:
 * 1. Protected paths via validatePath / validateRegistryPath
 * 2. Shared/ambiguous roots themselves
 * 3. Another installed app's territory
 * 4. Known-shared data directories (%LOCALAPPDATA%\Temp, Microsoft roots, Store Packages)
 * 5. Short names (< 3 chars)
 */
export function filterLeftoverCandidates(
  candidates: LeftoverCandidate[],
  installedApps: InstalledApp[] = [],
  opts?: CandidateFilterOptions
): LeftoverCandidate[] {
  const env = opts?.env || process.env;
  const roots = getEnvRoots(env);

  // Define shared/ambiguous roots (never candidates themselves, only their children)
  const sharedRoots = [
    normalizePathForComparison(roots.localAppData),
    normalizePathForComparison(roots.appData),
    normalizePathForComparison(roots.programData),
    normalizePathForComparison(roots.localPrograms),
    normalizePathForComparison(roots.programFiles),
    ...(roots.programFilesX86 ? [normalizePathForComparison(roots.programFilesX86)] : []),
    // Registry roots themselves
    'hkcu/software',
    'hklm/software',
    'hklm/software/wow6432node',
    'software',
    'software/wow6432node',
  ];

  // Define known-shared directories
  const knownSharedDirs = [
    normalizePathForComparison(path.join(roots.localAppData, 'Temp')),
    normalizePathForComparison(path.join(roots.appData, 'Microsoft')),
    normalizePathForComparison(path.join(roots.localAppData, 'Microsoft')),
    normalizePathForComparison(path.join(roots.programData, 'Microsoft')),
    normalizePathForComparison(path.join(roots.localAppData, 'Packages')),
  ];

  // Map other installed apps territories
  const otherApps = installedApps.filter((a) => !opts?.currentAppId || a.id !== opts.currentAppId);

  return candidates.filter((cand) => {
    // 5. Short name check: token must be >= 3 chars
    const basename = path.basename(cand.path.replace(/\\/g, '/'));
    const token = normalizeAppToken(basename);
    if (token.length < 3) {
      return false;
    }

    // 2. Shared/ambiguous roots check (root itself is never a candidate)
    const normPath = cand.path.toLowerCase().replace(/\\/g, '/').replace(/\/+$/, '');
    if (sharedRoots.includes(normPath)) {
      return false;
    }

    if (cand.kind === 'registry-key') {
      // Validate registry path
      const hiveMatch = cand.path.match(/^(HKCU|HKLM|HKCR|HKU)\\(.*)$/i);
      if (!hiveMatch) return false;
      const hive = hiveMatch[1];
      const keyPath = hiveMatch[2];
      const regVal = validateRegistryPath(hive, keyPath);
      if (!regVal.allowed) return false;

      // Check against shared registry roots
      const normReg = `${hive.toLowerCase()}/${keyPath.toLowerCase().replace(/\\/g, '/')}`;
      if (sharedRoots.includes(normReg)) return false;

      // Check against other installed apps registry keys/territory
      for (const other of otherApps) {
        if (other.registryKey) {
          const normOther = other.registryKey.toLowerCase().replace(/\\/g, '/');
          if (normReg === normOther) {
            return false;
          }
        }
        const normOtherName = normalizeAppToken(other.name);
        if (normOtherName.length >= 3 && token === normOtherName) {
          return false;
        }
      }

      return true;
    }

    // Filesystem validation (kind === 'file' | 'directory')
    // 1. Protected paths check via framework validatePath
    const pathVal = validatePath(cand.path, {
      allowAppLocations: true,
      allowNonExistent: true,
    });
    if (!pathVal.allowed) {
      return false;
    }

    const normResolved = normalizePathForComparison(cand.path);

    // 4. Known-shared data directories check
    for (const shared of knownSharedDirs) {
      // If it is the shared dir or inside the shared dir
      if (normResolved === shared || normResolved.startsWith(shared + '/')) {
        return false;
      }
    }

    // 3. Another installed app's territory check
    for (const other of otherApps) {
      if (other.installLocation && other.installLocation.trim()) {
        const otherLoc = normalizePathForComparison(other.installLocation.trim());
        if (normResolved === otherLoc || normResolved.startsWith(otherLoc + '/')) {
          return false;
        }
      }
      const otherToken = normalizeAppToken(other.name);
      if (otherToken.length >= 3 && token === otherToken) {
        return false;
      }
    }

    return true;
  });
}

/**
 * Measures directory size recursively.
 */
async function measureDirectorySize(
  dirPath: string,
  statFn?: (p: string) => Promise<{ isDirectory(): boolean; isFile(): boolean; size: number } | null>
): Promise<number | null> {
  try {
    let total = 0;
    const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        const sub = await measureDirectorySize(fullPath, statFn);
        if (sub !== null) total += sub;
      } else if (entry.isFile()) {
        if (statFn) {
          const s = await statFn(fullPath);
          if (s) total += s.size;
        } else {
          const stat = await fs.promises.stat(fullPath);
          total += stat.size;
        }
      }
    }
    return total;
  } catch {
    return null;
  }
}

/**
 * Scans candidate leftovers for an application.
 * Never throws: on failure returns scanned: false with failureReason and detectedCount: null.
 * Detection runs only after verified uninstall.
 */
export async function scanLeftovers(
  app: InstalledApp,
  opts?: LeftoverScanOptions
): Promise<LeftoverScanResult> {
  if (!app || typeof app !== 'object') {
    return {
      appId: '',
      appName: '',
      scanned: false,
      failureReason: 'Invalid app record',
      candidates: [],
      detectedCount: null,
      totalBytes: null,
    };
  }

  try {
    if (opts?.forceFailure) {
      throw new Error('Leftover scan failed due to forced failure');
    }

    // Guard: Detection runs only after verified uninstall (Phase 19 §3)
    if (opts?.requireVerified && opts?.installedApps) {
      const stillInstalled = opts.installedApps.some((a) => a.id === app.id);
      if (stillInstalled) {
        return {
          appId: app.id,
          appName: app.name,
          scanned: false,
          failureReason: `Application "${app.name}" is still installed; leftover detection runs only after verified uninstall.`,
          candidates: [],
          detectedCount: null,
          totalBytes: null,
        };
      }
    }

    const env = opts?.env || process.env;
    const rawCandidates = buildLeftoverCandidates(app, env);

    // In live execution, discover substring matches in the candidate roots
    const discoveredEntries: string[] = [];
    if (opts?.readdirFn) {
      const roots = getEnvRoots(env);
      const fsRoots = [roots.localAppData, roots.appData, roots.programData, roots.localPrograms];
      for (const root of fsRoots) {
        try {
          const children = await opts.readdirFn(root);
          for (const child of children) {
            discoveredEntries.push(path.join(root, child));
          }
        } catch {
          // Ignore unreadable root
        }
      }
    }

    if (opts?.readRegistrySubKeysFn) {
      const regRoots = ['HKCU\\Software', 'HKLM\\Software', 'HKLM\\Software\\WOW6432Node'];
      for (const root of regRoots) {
        try {
          const parts = root.split('\\');
          const hive = parts[0];
          const keyPath = parts.slice(1).join('\\');
          const subs = await opts.readRegistrySubKeysFn(hive, keyPath);
          for (const sub of subs) {
            discoveredEntries.push(`${root}\\${sub}`);
          }
        } catch {
          // Ignore unreadable subkeys
        }
      }
    }

    // Build enriched candidates if substring entries were found
    const candidatesWithDiscovered =
      discoveredEntries.length > 0
        ? buildLeftoverCandidates(app, env, { existingEntries: discoveredEntries })
        : rawCandidates;

    // Filter candidates through 5 mandatory exclusions
    const survivingCandidates = filterLeftoverCandidates(
      candidatesWithDiscovered,
      opts?.installedApps || [],
      { env, currentAppId: app.id }
    );

    // Measure existing candidates on disk / in registry
    const confirmedCandidates: LeftoverCandidate[] = [];

    for (const cand of survivingCandidates) {
      if (cand.kind === 'registry-key') {
        const hiveMatch = cand.path.match(/^(HKCU|HKLM|HKCR|HKU)\\(.*)$/i);
        if (!hiveMatch) continue;
        const hive = hiveMatch[1];
        const keyPath = hiveMatch[2];
        const exists = opts?.keyExistsFn
          ? await opts.keyExistsFn(hive, keyPath)
          : await keyExists(hive as any, keyPath);

        if (exists) {
          confirmedCandidates.push({
            ...cand,
            sizeBytes: null, // Registry keys have no byte size; never 0
          });
        }
      } else {
        // Filesystem candidate
        let exists = false;
        let isDir = cand.kind === 'directory';
        let size: number | null = null;

        if (opts?.statFn) {
          const s = await opts.statFn(cand.path);
          if (s) {
            exists = true;
            isDir = s.isDirectory();
            size = s.size;
          }
        } else {
          try {
            const stat = await fs.promises.stat(cand.path);
            exists = true;
            isDir = stat.isDirectory();
            size = stat.size;
          } catch {
            exists = false;
          }
        }

        if (exists) {
          let measuredSize: number | null = null;
          if (isDir) {
            measuredSize = opts?.measureDirSizeFn
              ? await opts.measureDirSizeFn(cand.path)
              : await measureDirectorySize(cand.path, opts?.statFn);
          } else {
            measuredSize = size;
          }

          confirmedCandidates.push({
            ...cand,
            sizeBytes: measuredSize,
          });
        }
      }
    }

    // Compute totalBytes: sum measured candidates only; null if none measured
    let measuredSum = 0;
    let hasAnyMeasured = false;
    for (const c of confirmedCandidates) {
      if (typeof c.sizeBytes === 'number') {
        measuredSum += c.sizeBytes;
        hasAnyMeasured = true;
      }
    }

    const totalBytes = hasAnyMeasured ? measuredSum : null;

    return {
      appId: app.id,
      appName: app.name,
      scanned: true,
      failureReason: null,
      candidates: confirmedCandidates,
      detectedCount: confirmedCandidates.length,
      totalBytes,
    };
  } catch (err) {
    return {
      appId: app.id,
      appName: app.name,
      scanned: false,
      failureReason: err instanceof Error ? err.message : String(err),
      candidates: [],
      detectedCount: null, // null when scanned is false — NEVER 0
      totalBytes: null,
    };
  }
}

/**
 * Builds an OperationPlan from selected leftover candidates.
 * Reversibility:
 * - Files/directories: reversible via Recycle Bin (D-R2-4)
 * - Registry keys: reversible with .reg backup
 */
export function createLeftoverCleanupPlan(
  result: LeftoverScanResult,
  selectedIds: string[],
  opts?: LeftoverPlanOptions
): OperationPlan {
  if (!result || !result.scanned) {
    throw new Error('Cannot create cleanup plan from an uncompleted or failed scan');
  }

  // Refuse empty selection (Phase 19 §4 & spec §6 case 13)
  if (!selectedIds || selectedIds.length === 0) {
    throw new Error('No leftover candidates selected for cleanup');
  }

  // Refuse candidate id absent from the fresh scan (spec §6 case 12)
  const candidateMap = new Map<string, LeftoverCandidate>();
  for (const c of result.candidates) {
    candidateMap.set(c.id, c);
  }

  for (const id of selectedIds) {
    if (!candidateMap.has(id)) {
      throw new Error(`Candidate ID "${id}" is absent from leftover scan result`);
    }
  }

  const selectedCandidates = selectedIds.map((id) => candidateMap.get(id)!);
  const actions: PlannedAction[] = [];
  const blocked: BlockedAction[] = [];
  let requiresElevation = false;

  for (const cand of selectedCandidates) {
    if (cand.kind === 'registry-key') {
      const hiveMatch = cand.path.match(/^(HKCU|HKLM|HKCR|HKU)\\(.*)$/i);
      const hive = hiveMatch ? hiveMatch[1].toUpperCase() : 'HKCU';
      const keyPath = hiveMatch ? hiveMatch[2] : cand.path;

      if (hive === 'HKLM') {
        requiresElevation = true;
      }

      const val = validateRegistryPath(hive, keyPath);
      if (!val.allowed) {
        blocked.push({
          target: cand.path,
          reason: val.reason || 'Protected registry key',
        });
        continue;
      }

      actions.push({
        id: `clean-${cand.id}`,
        kind: 'registry-key',
        target: cand.path,
        description: `Delete leftover registry key: ${cand.path}`,
        reclaimableBytes: null, // Registry keys have no byte size; never estimated
        metadata: {
          hive,
          keyPath,
          backupReg: true,
          leftoverCandidateId: cand.id,
        },
      });
    } else {
      // File or directory
      const val = validatePath(cand.path, {
        allowAppLocations: true,
        allowNonExistent: true,
      });

      if (!val.allowed) {
        blocked.push({
          target: cand.path,
          reason: val.reason || 'Protected system path',
        });
        continue;
      }

      const normLower = cand.path.toLowerCase();
      if (normLower.includes('program files') || normLower.includes('programdata')) {
        requiresElevation = true;
      }

      actions.push({
        id: `clean-${cand.id}`,
        kind: cand.kind === 'directory' ? 'delete-tree' : 'delete-file',
        target: cand.path,
        description: `Remove leftover ${cand.kind}: ${cand.path}`,
        reclaimableBytes: cand.sizeBytes,
        metadata: {
          deletionMethod: 'recycle-bin',
          leftoverCandidateId: cand.id,
        },
      });
    }
  }

  const plan = createOperationPlan({
    module: 'app-remover',
    actions,
    blocked,
    reversibility: 'reversible',
    requiresElevation,
  });

  if (opts?.planId) {
    plan.id = opts.planId;
  }

  return plan;
}
