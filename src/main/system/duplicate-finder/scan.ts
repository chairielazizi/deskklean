import fs from 'fs';
import path from 'path';
import {
  DuplicateFile,
  DuplicateGroup,
  DuplicateScanConfig,
  DuplicateScanResult,
} from '../../../shared/types';
import { isWindows, runPowerShell } from '../powershell';
import { getFsPath, stripExtendedPath, isPathInsideRoot } from '../disk-analyzer/walk';
import {
  DEFAULT_HASH_WINDOW_BYTES,
  DEFAULT_PARTIAL_HASH_THRESHOLD_BYTES,
  computeFullHash,
  computePartialHash,
} from './hash';
import { selectKeepCopy } from './keepcopy';

export interface CandidateFile {
  path: string;
  size: number;
  birthtimeMs: number;
  mtime: string;
  name: string;
  hash?: string;
}

export interface ScanOptions {
  partialHashThresholdBytes?: number;
  hashWindowBytes?: number;
  checkReparsePointAttr?: (filePath: string) => Promise<boolean>;
  checkHardlink?: (filePath: string, stat: fs.Stats) => Promise<boolean>;
}

/**
 * Checks if a file is a hardlink via PowerShell Get-Item's LinkType.
 * Fallback only if fs.Stats.nlink is unavailable or wrong (D-DF-6).
 */
export async function checkHardlinkFallback(filePath: string): Promise<boolean> {
  if (!isWindows()) return false;
  try {
    const escaped = filePath.replace(/'/g, "''");
    const script = `(Get-Item -LiteralPath '${escaped}').LinkType`;
    const out = await runPowerShell(script, { timeoutMs: 5000 });
    const linkType = out.trim().toLowerCase();
    return linkType === 'hardlink';
  } catch (err) {
    console.warn(
      `[DuplicateFinder] Hardlink fallback check failed for "${filePath}", continuing without hardlink filtering:`,
      err
    );
    return false;
  }
}

/**
 * Detects hardlink using fs.Stats.nlink > 1 as primary mechanism (D-DF-6).
 * No extra syscalls, no process spawns when nlink is present.
 * If nlink is unavailable or not a number, falls back to PowerShell Get-Item LinkType.
 * If that also fails, logs a warning and returns false (degrade, do not fail scan).
 */
export async function isHardlink(
  filePath: string,
  stat: fs.Stats,
  fallbackFn: (filePath: string) => Promise<boolean> = checkHardlinkFallback
): Promise<boolean> {
  if (typeof stat.nlink === 'number' && !isNaN(stat.nlink)) {
    return stat.nlink > 1;
  }
  return fallbackFn(filePath);
}

/**
 * Checks if a file has the ReparsePoint attribute set via PowerShell Get-Item (D-DF-5).
 */
export async function checkReparsePointAttribute(filePath: string): Promise<boolean> {
  if (!isWindows()) return false;
  try {
    const escaped = filePath.replace(/'/g, "''");
    const script = `((Get-Item -LiteralPath '${escaped}').Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0`;
    const out = await runPowerShell(script, { timeoutMs: 5000 });
    return out.trim().toLowerCase() === 'true';
  } catch (err) {
    console.warn(`[DuplicateFinder] Failed to check ReparsePoint attribute for "${filePath}":`, err);
    return false;
  }
}

function matchesFileTypes(fileName: string, fileTypes?: string[]): boolean {
  if (!fileTypes || fileTypes.length === 0 || fileTypes.includes('*') || fileTypes.includes('.*')) {
    return true;
  }
  const ext = path.extname(fileName).toLowerCase();
  return fileTypes.some((t) => {
    const norm = t.startsWith('.') ? t.toLowerCase() : `.${t.toLowerCase()}`;
    return norm === ext;
  });
}

/**
 * Executes Phase 10 Duplicate Finder scan:
 * 1. Root verification (refuse if reparse point)
 * 2. Enumeration: walk root, skip reparse points and hardlinks, filter by minSizeBytes
 * 3. Size index: group candidate files by exact byte size
 * 4. Hashing: two-stage SHA-256 (partial hash prefilter for files >= 10 MB, full hash confirmation)
 * 5. Keep-copy selection: apply D-DF-8 pure logic to select canonical copy
 * 6. Assemble DuplicateScanResult (read-only, no mutations)
 */
export async function scanDuplicates(
  config: DuplicateScanConfig,
  options: ScanOptions = {}
): Promise<DuplicateScanResult> {
  const startTime = Date.now();

  // D-DF-3 / Binding rule: matchBy 'name-size' is coerced to 'hash' with logged warning
  if (config.matchBy === 'name-size') {
    console.warn(
      '[DuplicateFinder] matchBy "name-size" is not supported and has been coerced to "hash" per D-DF-3 binding rule.'
    );
  }

  // D-DF-4: Minimum size threshold (default 1 MB)
  const minSizeBytes =
    typeof config.minSizeBytes === 'number' && config.minSizeBytes >= 0
      ? config.minSizeBytes
      : 1024 * 1024;

  const partialHashThresholdBytes =
    options.partialHashThresholdBytes ?? DEFAULT_PARTIAL_HASH_THRESHOLD_BYTES;
  const hashWindowBytes = options.hashWindowBytes ?? DEFAULT_HASH_WINDOW_BYTES;
  const checkReparsePointAttr = options.checkReparsePointAttr ?? checkReparsePointAttribute;
  const checkHardlinkFn = options.checkHardlink ?? isHardlink;

  const rawDirs = config.directories && config.directories.length > 0 ? config.directories : [];
  if (rawDirs.length === 0) {
    throw new Error('Scan refused: no scan directory specified (D-DF-1).');
  }

  let scannedFileCount = 0;
  let skippedCount = 0;
  let belowMinSizeCount = 0;
  const resolvedRoots: string[] = [];

  // Size index: Map<exact byte size, CandidateFile[]>
  const sizeIndex = new Map<number, CandidateFile[]>();

  for (const rawDir of rawDirs) {
    const cleanDir = stripExtendedPath(rawDir);
    let dirStat: fs.Stats;
    try {
      dirStat = fs.lstatSync(getFsPath(cleanDir));
    } catch {
      skippedCount++;
      continue;
    }

    // D-DF-5 / Rails: Refuse scan if root is a reparse point or symlink
    if (dirStat.isSymbolicLink()) {
      throw new Error(`Scan root "${cleanDir}" is a reparse point / symbolic link, which is not allowed.`);
    }

    let resolvedRoot: string;
    try {
      resolvedRoot = fs.realpathSync(getFsPath(cleanDir));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Scan root "${cleanDir}" could not be resolved: ${msg}`);
    }

    const normResolvedRoot = stripExtendedPath(resolvedRoot).replace(/[\\/]+$/, '');
    const normCleanDir = cleanDir.replace(/[\\/]+$/, '');
    const isSameRoot =
      process.platform === 'win32'
        ? normResolvedRoot.toLowerCase() === normCleanDir.toLowerCase()
        : normResolvedRoot === normCleanDir;

    if (!isSameRoot) {
      throw new Error(
        `Scan root "${cleanDir}" resolves to "${resolvedRoot}" (reparse point / junction), which is not allowed.`
      );
    }

    resolvedRoots.push(normResolvedRoot);

    // Enqueue directory for walking
    const queue: string[] = [normResolvedRoot];

    while (queue.length > 0) {
      const currentDir = queue.shift()!;
      let entries: fs.Dirent[];

      try {
        entries = fs.readdirSync(getFsPath(currentDir), { withFileTypes: true });
      } catch {
        skippedCount++;
        continue;
      }

      for (const entry of entries) {
        const entryPath = path.join(currentDir, entry.name);
        const fsEntryPath = getFsPath(entryPath);

        let lstat: fs.Stats;
        try {
          lstat = fs.lstatSync(fsEntryPath);
        } catch (err: unknown) {
          const error = err as { code?: string };
          if (error.code === 'ENOENT') {
            // File vanished mid-scan, skip silently per spec
            continue;
          }
          skippedCount++;
          continue;
        }

        // Reparse point check on entry: skip any symbolic link immediately (D-DF-5)
        if (lstat.isSymbolicLink()) {
          skippedCount++;
          continue;
        }

        if (entry.isDirectory()) {
          // Directory reparse point / junction check via realpathSync (Phase 9 walk pattern)
          let resolvedDir: string;
          try {
            resolvedDir = fs.realpathSync(fsEntryPath);
          } catch {
            skippedCount++;
            continue;
          }

          const normResolved = stripExtendedPath(resolvedDir).replace(/[\\/]+$/, '');
          const normEntry = stripExtendedPath(entryPath).replace(/[\\/]+$/, '');
          const isSameDir =
            process.platform === 'win32'
              ? normResolved.toLowerCase() === normEntry.toLowerCase()
              : normResolved === normEntry;

          if (!isSameDir) {
            // Reparse point / junction encountered
            skippedCount++;
            continue;
          }

          // Root containment check
          if (!isPathInsideRoot(normResolved, normResolvedRoot)) {
            skippedCount++;
            continue;
          }

          queue.push(entryPath);
        } else if (entry.isFile()) {
          // Root containment check
          if (!isPathInsideRoot(stripExtendedPath(entryPath), normResolvedRoot)) {
            skippedCount++;
            continue;
          }

          // Hardlink detection using stat.nlink > 1 (D-DF-6)
          const hardlink = await checkHardlinkFn(entryPath, lstat);
          if (hardlink) {
            skippedCount++;
            continue;
          }

          // Minimum size filter (D-DF-4) & zero-byte exclusion (binding rule)
          const fileSize = lstat.size;
          if (fileSize === 0 || fileSize < minSizeBytes) {
            belowMinSizeCount++;
            continue;
          }

          // File type / extension filter
          if (!matchesFileTypes(entry.name, config.fileTypes)) {
            continue;
          }

          scannedFileCount++;

          let bucket = sizeIndex.get(fileSize);
          if (!bucket) {
            bucket = [];
            sizeIndex.set(fileSize, bucket);
          }

          bucket.push({
            path: stripExtendedPath(entryPath),
            size: fileSize,
            birthtimeMs: lstat.birthtimeMs,
            mtime: lstat.mtime.toISOString(),
            name: entry.name,
          });
        }
      }
    }
  }

  // Hashing Phase: Two-stage hashing within same-size buckets
  const confirmedGroups: CandidateFile[][] = [];

  for (const [fileSize, candidates] of sizeIndex.entries()) {
    if (candidates.length < 2) {
      continue;
    }

    // Verify reparse point attributes on candidates before reading/hashing
    const verifiedCandidates: CandidateFile[] = [];
    for (const cand of candidates) {
      const isReparse = await checkReparsePointAttr(cand.path);
      if (isReparse) {
        skippedCount++;
      } else {
        verifiedCandidates.push(cand);
      }
    }

    if (verifiedCandidates.length < 2) {
      continue;
    }

    if (fileSize < partialHashThresholdBytes) {
      // Direct full SHA-256 for files below partial-hash threshold
      const fullHashMap = new Map<string, CandidateFile[]>();
      for (const cand of verifiedCandidates) {
        try {
          const hash = await computeFullHash(getFsPath(cand.path));
          cand.hash = hash;
          let list = fullHashMap.get(hash);
          if (!list) {
            list = [];
            fullHashMap.set(hash, list);
          }
          list.push(cand);
        } catch {
          // Unreadable file (e.g. locked, access denied) counted as skipped
          skippedCount++;
        }
      }

      for (const group of fullHashMap.values()) {
        if (group.length >= 2) {
          confirmedGroups.push(group);
        }
      }
    } else {
      // Files >= threshold: compute partial hash first (D-DF-3)
      const partialHashMap = new Map<string, CandidateFile[]>();
      for (const cand of verifiedCandidates) {
        try {
          const partialHash = await computePartialHash(
            getFsPath(cand.path),
            fileSize,
            hashWindowBytes
          );
          let list = partialHashMap.get(partialHash);
          if (!list) {
            list = [];
            partialHashMap.set(partialHash, list);
          }
          list.push(cand);
        } catch {
          skippedCount++;
        }
      }

      for (const partialGroup of partialHashMap.values()) {
        if (partialGroup.length < 2) {
          // No partial collision; files cannot be identical
          continue;
        }

        // Partial collision! Full SHA-256 confirmation is mandatory per D-DF-3
        const fullHashMap = new Map<string, CandidateFile[]>();
        for (const cand of partialGroup) {
          try {
            const fullHash = await computeFullHash(getFsPath(cand.path));
            cand.hash = fullHash;
            let list = fullHashMap.get(fullHash);
            if (!list) {
              list = [];
              fullHashMap.set(fullHash, list);
            }
            list.push(cand);
          } catch {
            skippedCount++;
          }
        }

        for (const group of fullHashMap.values()) {
          if (group.length >= 2) {
            confirmedGroups.push(group);
          }
        }
      }
    }
  }

  // Keep-Copy Selection (D-DF-8) & Result Assembly
  let fileCounter = 1;
  const groups: DuplicateGroup[] = [];

  for (const confirmedFiles of confirmedGroups) {
    const keepCopy = selectKeepCopy(confirmedFiles);

    const duplicateFiles: DuplicateFile[] = confirmedFiles.map((f) => {
      const isOriginal = f.path === keepCopy.path;
      return {
        id: `dup-${fileCounter++}`,
        path: f.path,
        name: f.name,
        sizeBytes: f.size,
        hash: f.hash!,
        lastModified: f.mtime,
        selectedForDeletion: !isOriginal,
        isOriginal,
      };
    });

    const groupSize = confirmedFiles[0].size;
    const groupWastedBytes = groupSize * (duplicateFiles.length - 1);

    groups.push({
      hash: confirmedFiles[0].hash!,
      fileName: keepCopy.name,
      sizeBytes: groupSize,
      wastedBytes: groupWastedBytes,
      files: duplicateFiles,
    });
  }

  const duplicateGroupCount = groups.length;
  const duplicateFileCount = groups.reduce((sum, g) => sum + g.files.length, 0);
  const wastedBytes = groups.reduce((sum, g) => sum + g.wastedBytes, 0);
  const scanDurationMs = Date.now() - startTime;
  const scannedAt = new Date().toISOString();

  return {
    root: resolvedRoots.join('; '),
    scannedFileCount,
    skippedCount,
    belowMinSizeCount,
    duplicateGroupCount,
    duplicateFileCount,
    wastedBytes,
    groups,
    scanDurationMs,
    scannedAt,
  };
}
