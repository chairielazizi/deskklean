import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  SmartCleanReport,
  SmartCleanCategory,
  SmartCleanFileEntry,
  SmartCleanSkippedFile,
  SmartCleanCategoryStatus,
} from '../../../shared/types';
import {
  SmartCleanCategoryDefinition,
  DEFAULT_CATEGORIES,
  ALL_CANDIDATE_CATEGORIES,
  EXCLUDED_CATEGORIES,
} from './categories';
import { validatePath } from '../framework/protected';
import { isWindows, runPowerShell } from '../powershell';

/**
 * Resolves Windows environment variables (%VAR%) against a provided environment dictionary
 * or process.env, falling back to cross-platform standard paths.
 * Never hardcodes usernames or fixed profiles.
 */
export function resolveEnvPath(rawPath: string, env: NodeJS.ProcessEnv = process.env): string {
  const userProfile = env.USERPROFILE || os.homedir();
  const systemRoot = env.SystemRoot || env.windir || 'C:\\Windows';
  const systemDrive = env.SystemDrive || (systemRoot.match(/^[a-zA-Z]:/) ? systemRoot.substring(0, 2) : 'C:');
  const programData = env.ProgramData || `${systemDrive}\\ProgramData`;

  // Standard fallback map for common Windows variables (case-insensitive lookup)
  const envLookup: Record<string, string> = {
    userprofile: userProfile,
    systemroot: systemRoot,
    windir: systemRoot,
    systemdrive: systemDrive,
    programdata: programData,
    localappdata:
      env.LOCALAPPDATA ||
      (env.USERPROFILE ? path.join(env.USERPROFILE, 'AppData', 'Local') : path.join(userProfile, 'AppData', 'Local')),
    appdata:
      env.APPDATA ||
      (env.USERPROFILE ? path.join(env.USERPROFILE, 'AppData', 'Roaming') : path.join(userProfile, 'AppData', 'Roaming')),
    temp: env.TEMP || env.TMP || (env.LOCALAPPDATA ? path.join(env.LOCALAPPDATA, 'Temp') : path.join(userProfile, 'AppData', 'Local', 'Temp')),
  };

  // Populate from provided env taking lowercase keys
  for (const [k, v] of Object.entries(env)) {
    if (v !== undefined) {
      envLookup[k.toLowerCase()] = v;
    }
  }

  // Replace all %VAR% tokens
  const resolved = rawPath.replace(/%([a-zA-Z0-9_()]+)%/g, (_, varName: string) => {
    const key = varName.toLowerCase();
    if (key in envLookup) {
      return envLookup[key];
    }
    return '';
  });

  return resolved;
}

/**
 * Converts a simple wildcard glob pattern (e.g. 'thumbcache_*.db') into a case-insensitive RegExp.
 */
export function globToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`, 'i');
}

/**
 * Detects whether a filesystem error represents a locked file / share violation / file in use.
 */
export function isFileInUseError(err: unknown): boolean {
  if (!err) return false;
  const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  const code = (err as { code?: string })?.code;

  return (
    code === 'EBUSY' ||
    code === 'EPERM' ||
    code === 'EACCES' ||
    msg.includes('busy') ||
    msg.includes('locked') ||
    msg.includes('sharing violation') ||
    msg.includes('lock violation') ||
    msg.includes('being used by another process')
  );
}

export interface WalkOptions {
  env?: NodeJS.ProcessEnv;
  scanRootOverride?: string;
  customExcludedPaths?: string[];
}

/**
 * Scans a single category definition using Node fs without modifying or deleting anything.
 * Refuses protected paths using central enforcement from protected.ts.
 * Files in use are skipped and counted separately.
 */
export async function scanCategory(
  categoryDef: SmartCleanCategoryDefinition,
  options: WalkOptions = {}
): Promise<SmartCleanCategory> {
  const env = options.env || process.env;
  const resolvedPath = options.scanRootOverride || resolveEnvPath(categoryDef.rawPath, env);

  // 1. Recycle Bin special handling via shell
  if (categoryDef.strategy === 'shell') {
    return scanRecycleBin(categoryDef, resolvedPath);
  }

  // 2. VSS System Restore points special handling
  if (categoryDef.strategy === 'vss') {
    return scanSystemRestore(categoryDef, resolvedPath);
  }

  // 3. Central enforcement: Check root path against the protected list
  const rootValidation = validatePath(resolvedPath, {
    customExcludedPaths: options.customExcludedPaths,
    allowNonExistent: true,
  });

  if (!rootValidation.allowed) {
    return {
      id: categoryDef.id,
      name: categoryDef.name,
      path: resolvedPath,
      verdict: categoryDef.verdict,
      source: categoryDef.source,
      reclaimableBytes: null,
      fileCount: null,
      inUseCount: 0,
      status: 'failed',
      failureReason: rootValidation.reason || `Target path is protected by system integrity policy: ${resolvedPath}`,
      files: [],
      skippedFiles: [],
      adminRequired: categoryDef.adminRequired,
      deletionMethod: categoryDef.deletionMethod,
      defaultEnabled: categoryDef.defaultEnabled,
      consequence: categoryDef.consequence,
    };
  }

  // 4. Verify path existence
  let rootStat: fs.Stats;
  try {
    rootStat = await fs.promises.stat(resolvedPath);
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return {
      id: categoryDef.id,
      name: categoryDef.name,
      path: resolvedPath,
      verdict: categoryDef.verdict,
      source: categoryDef.source,
      reclaimableBytes: null,
      fileCount: null,
      inUseCount: 0,
      status: 'failed',
      failureReason: `Path cannot be accessed: ${errorMsg}`,
      files: [],
      skippedFiles: [],
      adminRequired: categoryDef.adminRequired,
      deletionMethod: categoryDef.deletionMethod,
      defaultEnabled: categoryDef.defaultEnabled,
      consequence: categoryDef.consequence,
    };
  }

  // 5. Single file target (e.g. MEMORY.DMP)
  if (rootStat.isFile()) {
    try {
      const handle = await fs.promises.open(resolvedPath, 'r');
      await handle.close();
      return {
        id: categoryDef.id,
        name: categoryDef.name,
        path: resolvedPath,
        verdict: categoryDef.verdict,
        source: categoryDef.source,
        reclaimableBytes: rootStat.size,
        fileCount: 1,
        inUseCount: 0,
        status: 'scanned',
        files: [{ path: resolvedPath, sizeBytes: rootStat.size }],
        skippedFiles: [],
        adminRequired: categoryDef.adminRequired,
        deletionMethod: categoryDef.deletionMethod,
        defaultEnabled: categoryDef.defaultEnabled,
        consequence: categoryDef.consequence,
      };
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return {
        id: categoryDef.id,
        name: categoryDef.name,
        path: resolvedPath,
        verdict: categoryDef.verdict,
        source: categoryDef.source,
        reclaimableBytes: 0,
        fileCount: 0,
        inUseCount: 1,
        status: 'partial',
        files: [],
        skippedFiles: [{ path: resolvedPath, reason: `File in use: ${errorMsg}` }],
        adminRequired: categoryDef.adminRequired,
        deletionMethod: categoryDef.deletionMethod,
        defaultEnabled: categoryDef.defaultEnabled,
        consequence: categoryDef.consequence,
      };
    }
  }

  // 6. Directory walk (recursive with file-in-use and protected list checks)
  const files: SmartCleanFileEntry[] = [];
  const skippedFiles: SmartCleanSkippedFile[] = [];
  const globRegex = categoryDef.globPattern ? globToRegExp(categoryDef.globPattern) : null;

  const dirQueue: string[] = [resolvedPath];

  while (dirQueue.length > 0) {
    const currentDir = dirQueue.shift()!;
    let entries: fs.Dirent[];

    try {
      entries = await fs.promises.readdir(currentDir, { withFileTypes: true });
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      if (currentDir === resolvedPath) {
        return {
          id: categoryDef.id,
          name: categoryDef.name,
          path: resolvedPath,
          verdict: categoryDef.verdict,
          source: categoryDef.source,
          reclaimableBytes: null,
          fileCount: null,
          inUseCount: 0,
          status: 'failed',
          failureReason: `Directory cannot be read: ${errorMsg}`,
          files: [],
          skippedFiles: [],
          adminRequired: categoryDef.adminRequired,
          deletionMethod: categoryDef.deletionMethod,
          defaultEnabled: categoryDef.defaultEnabled,
          consequence: categoryDef.consequence,
        };
      }
      // Subdirectory read failure: record as skipped without aborting the category
      skippedFiles.push({ path: currentDir, reason: `Directory in use or unreadable: ${errorMsg}` });
      continue;
    }

    for (const entry of entries) {
      const childPath = path.join(currentDir, entry.name);

      // Guard: Reparse points / symlinks are skipped to prevent directory escape
      if (entry.isSymbolicLink()) {
        continue;
      }

      if (entry.isDirectory()) {
        const childVal = validatePath(childPath, {
          scanRoot: resolvedPath,
          customExcludedPaths: options.customExcludedPaths,
          allowNonExistent: true,
        });

        if (!childVal.allowed) {
          skippedFiles.push({
            path: childPath,
            reason: childVal.reason || 'Protected subpath excluded',
          });
          continue;
        }

        dirQueue.push(childPath);
      } else if (entry.isFile()) {
        if (globRegex && !globRegex.test(entry.name)) {
          continue;
        }

        const childVal = validatePath(childPath, {
          scanRoot: resolvedPath,
          customExcludedPaths: options.customExcludedPaths,
          allowNonExistent: true,
        });

        if (!childVal.allowed) {
          skippedFiles.push({
            path: childPath,
            reason: childVal.reason || 'Protected file excluded',
          });
          continue;
        }

        try {
          const stat = await fs.promises.stat(childPath);
          const handle = await fs.promises.open(childPath, 'r');
          await handle.close();
          files.push({ path: childPath, sizeBytes: stat.size });
        } catch (err: unknown) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          skippedFiles.push({
            path: childPath,
            reason: isFileInUseError(err) ? `File in use: ${errorMsg}` : `Unreadable file: ${errorMsg}`,
          });
        }
      }
    }
  }

  const measuredTotalBytes = files.reduce((sum, f) => sum + f.sizeBytes, 0);
  const status: SmartCleanCategoryStatus = skippedFiles.length > 0 ? 'partial' : 'scanned';

  return {
    id: categoryDef.id,
    name: categoryDef.name,
    path: resolvedPath,
    verdict: categoryDef.verdict,
    source: categoryDef.source,
    reclaimableBytes: measuredTotalBytes,
    fileCount: files.length,
    inUseCount: skippedFiles.length,
    status,
    files,
    skippedFiles,
    adminRequired: categoryDef.adminRequired,
    deletionMethod: categoryDef.deletionMethod,
    defaultEnabled: categoryDef.defaultEnabled,
    consequence: categoryDef.consequence,
  };
}

/**
 * Scans Windows Recycle Bin via Shell COM API on Windows.
 * On non-Windows platforms or upon shell error, reports failed status without fabrication.
 */
async function scanRecycleBin(
  categoryDef: SmartCleanCategoryDefinition,
  resolvedPath: string
): Promise<SmartCleanCategory> {
  if (!isWindows()) {
    return {
      id: categoryDef.id,
      name: categoryDef.name,
      path: resolvedPath,
      verdict: categoryDef.verdict,
      source: categoryDef.source,
      reclaimableBytes: null,
      fileCount: null,
      inUseCount: 0,
      status: 'failed',
      failureReason: 'Recycle Bin enumeration requires Windows Shell COM API',
      files: [],
      skippedFiles: [],
      adminRequired: categoryDef.adminRequired,
      deletionMethod: categoryDef.deletionMethod,
      defaultEnabled: categoryDef.defaultEnabled,
    };
  }

  try {
    const script = `
      $sh = New-Object -ComObject Shell.Application;
      $bin = $sh.Namespace(0xA);
      $items = @();
      $total = 0;
      if ($bin -ne $null) {
        foreach ($i in $bin.Items()) {
          $sz = [int64]$i.Size;
          $total += $sz;
          $items += [PSCustomObject]@{ path = $i.Path; sizeBytes = $sz };
        }
      }
      [PSCustomObject]@{ count = $items.Count; totalBytes = $total; files = $items } | ConvertTo-Json -Compress
    `;

    const output = await runPowerShell(script, { timeoutMs: 8000 });
    const parsed = JSON.parse(output) as {
      count: number;
      totalBytes: number;
      files: { path: string; sizeBytes: number }[] | { path: string; sizeBytes: number };
    };

    const filesArray = Array.isArray(parsed.files) ? parsed.files : parsed.files ? [parsed.files] : [];

    return {
      id: categoryDef.id,
      name: categoryDef.name,
      path: resolvedPath,
      verdict: categoryDef.verdict,
      source: categoryDef.source,
      reclaimableBytes: parsed.totalBytes,
      fileCount: parsed.count,
      inUseCount: 0,
      status: 'scanned',
      files: filesArray,
      skippedFiles: [],
      adminRequired: categoryDef.adminRequired,
      deletionMethod: categoryDef.deletionMethod,
      defaultEnabled: categoryDef.defaultEnabled,
    };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return {
      id: categoryDef.id,
      name: categoryDef.name,
      path: resolvedPath,
      verdict: categoryDef.verdict,
      source: categoryDef.source,
      reclaimableBytes: null,
      fileCount: null,
      inUseCount: 0,
      status: 'failed',
      failureReason: `Windows Shell Recycle Bin query failed: ${errorMsg}`,
      files: [],
      skippedFiles: [],
      adminRequired: categoryDef.adminRequired,
      deletionMethod: categoryDef.deletionMethod,
      defaultEnabled: categoryDef.defaultEnabled,
    };
  }
}

/**
 * Scans System Restore points via Windows VSS.
 */
async function scanSystemRestore(
  categoryDef: SmartCleanCategoryDefinition,
  resolvedPath: string
): Promise<SmartCleanCategory> {
  if (!isWindows()) {
    return {
      id: categoryDef.id,
      name: categoryDef.name,
      path: resolvedPath,
      verdict: categoryDef.verdict,
      source: categoryDef.source,
      reclaimableBytes: null,
      fileCount: null,
      inUseCount: 0,
      status: 'failed',
      failureReason: 'System Restore enumeration requires Windows Volume Shadow Copy Service (VSS)',
      files: [],
      skippedFiles: [],
      adminRequired: categoryDef.adminRequired,
      deletionMethod: categoryDef.deletionMethod,
      defaultEnabled: categoryDef.defaultEnabled,
      consequence: categoryDef.consequence,
    };
  }

  try {
    const script = `
      $shadows = Get-CimInstance Win32_ShadowCopy -ErrorAction Stop;
      $count = if ($shadows) { @($shadows).Count } else { 0 };
      [PSCustomObject]@{ count = $count } | ConvertTo-Json -Compress
    `;

    const output = await runPowerShell(script, { timeoutMs: 8000 });
    const parsed = JSON.parse(output) as { count: number };

    return {
      id: categoryDef.id,
      name: categoryDef.name,
      path: resolvedPath,
      verdict: categoryDef.verdict,
      source: categoryDef.source,
      reclaimableBytes: null, // VSS shadow copy size is shared in system volume pool
      fileCount: parsed.count,
      inUseCount: 0,
      status: 'scanned',
      files: [],
      skippedFiles: [],
      adminRequired: categoryDef.adminRequired,
      deletionMethod: categoryDef.deletionMethod,
      defaultEnabled: categoryDef.defaultEnabled,
      consequence: categoryDef.consequence,
    };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return {
      id: categoryDef.id,
      name: categoryDef.name,
      path: resolvedPath,
      verdict: categoryDef.verdict,
      source: categoryDef.source,
      reclaimableBytes: null,
      fileCount: null,
      inUseCount: 0,
      status: 'failed',
      failureReason: `VSS restore points query failed: ${errorMsg}`,
      files: [],
      skippedFiles: [],
      adminRequired: categoryDef.adminRequired,
      deletionMethod: categoryDef.deletionMethod,
      defaultEnabled: categoryDef.defaultEnabled,
      consequence: categoryDef.consequence,
    };
  }
}

export interface ScanSmartCleanOptions {
  env?: NodeJS.ProcessEnv;
  categories?: SmartCleanCategoryDefinition[];
  scanRootOverrides?: Record<string, string>;
  customExcludedPaths?: string[];
}

/**
 * Main Phase 5 read-only scan entry point.
 * Scans enabled categories, measures bytes and file counts, and returns a SmartCleanReport.
 * Never modifies or deletes any filesystem entries.
 * Measures real elapsed duration.
 */
export async function scanSmartClean(
  enabledCategoryIds?: string[],
  options: ScanSmartCleanOptions = {}
): Promise<SmartCleanReport> {
  const startTime = Date.now();

  const candidatePool = options.categories || ALL_CANDIDATE_CATEGORIES;

  // Filter categories to scan
  let categoriesToScan: SmartCleanCategoryDefinition[];
  if (enabledCategoryIds && enabledCategoryIds.length > 0) {
    categoriesToScan = candidatePool.filter((cat) => enabledCategoryIds.includes(cat.id));
  } else {
    categoriesToScan = candidatePool.filter((cat) => cat.defaultEnabled);
  }

  // Scan all enabled categories concurrently
  const scanPromises = categoriesToScan.map(async (catDef) => {
    try {
      const override = options.scanRootOverrides?.[catDef.id];
      return await scanCategory(catDef, {
        env: options.env,
        scanRootOverride: override,
        customExcludedPaths: options.customExcludedPaths,
      });
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return {
        id: catDef.id,
        name: catDef.name,
        path: catDef.rawPath,
        verdict: catDef.verdict,
        source: catDef.source,
        reclaimableBytes: null,
        fileCount: null,
        inUseCount: 0,
        status: 'failed' as SmartCleanCategoryStatus,
        failureReason: `Unexpected scan failure: ${errorMsg}`,
        files: [],
        skippedFiles: [],
        adminRequired: catDef.adminRequired,
        deletionMethod: catDef.deletionMethod,
        defaultEnabled: catDef.defaultEnabled,
        consequence: catDef.consequence,
      };
    }
  });

  const categoryResults = await Promise.all(scanPromises);

  // Calculate real total reclaimable bytes (sum of real measurements, never estimated)
  let totalReclaimableBytes = 0;
  for (const cat of categoryResults) {
    if (typeof cat.reclaimableBytes === 'number' && Number.isFinite(cat.reclaimableBytes)) {
      totalReclaimableBytes += cat.reclaimableBytes;
    }
  }

  const scanDurationMs = Math.max(0, Date.now() - startTime);

  return {
    generatedAt: new Date().toISOString(),
    scanDurationMs,
    categories: categoryResults,
    excluded: EXCLUDED_CATEGORIES,
    totalReclaimableBytes,
  };
}
