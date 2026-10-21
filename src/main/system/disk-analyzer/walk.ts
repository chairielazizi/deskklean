import fs from 'fs';
import path from 'path';
import {
  DiskFileType,
  DiskFolderNode,
  SkippedPath,
  DiskAnalysisResult,
  ScanProgressEvent,
} from '../../../shared/types';
import { extensionToCategory } from './categorize';
import {
  LargeFileCandidate,
  finalizeFolderTree,
  buildFileTypeBreakdown,
  finalizeLargeFiles,
  assembleDiskAnalysisResult,
} from './result';

/**
 * Prefixes a path with Windows extended-length prefix (\\?\) if length > 260.
 * Throws if the path cannot be prefixed (e.g. relative path on Windows).
 */
export function toExtendedPath(p: string): string {
  if (!p) return p;
  if (p.startsWith('\\\\?\\') || p.startsWith('\\\\.\\')) {
    return p;
  }
  if (p.startsWith('\\\\')) {
    return `\\\\?\\UNC\\${p.slice(2)}`;
  }
  if (/^[a-zA-Z]:[\\/]/.test(p)) {
    const normalized = p.replace(/\//g, '\\');
    return `\\\\?\\${normalized}`;
  }
  throw new Error(`Cannot prefix path with extended-length prefix: "${p}" is not an absolute Windows path`);
}

/**
 * Strips Windows extended-length prefix (\\?\ or \\?\UNC\) so UI and results never see it.
 */
export function stripExtendedPath(p: string): string {
  if (!p) return p;
  if (p.startsWith('\\\\?\\UNC\\')) {
    return `\\\\${p.slice(8)}`;
  }
  if (p.startsWith('\\\\?\\')) {
    return p.slice(4);
  }
  return p;
}

/**
 * Returns the path formatted for fs calls on the current platform,
 * adding extended-length prefix on Windows if path exceeds 260 characters.
 */
export function getFsPath(p: string): string {
  if (process.platform === 'win32' && p.length > 260) {
    return toExtendedPath(p);
  }
  return p;
}

/**
 * Determines whether targetPath resolves inside rootPath or escapes it.
 * Distinguishes in-root reparse points from escapes honestly.
 */
export function isPathInsideRoot(targetPath: string, rootPath: string): boolean {
  const normTarget = stripExtendedPath(targetPath);
  const normRoot = stripExtendedPath(rootPath);

  const isTargetWin = /^[a-zA-Z]:[\\/]/.test(normTarget);
  const isRootWin = /^[a-zA-Z]:[\\/]/.test(normRoot);

  if (isTargetWin && isRootWin) {
    if (normTarget[0].toLowerCase() !== normRoot[0].toLowerCase()) {
      return false;
    }
    const cleanTarget = normTarget.replace(/\//g, '\\').toLowerCase();
    const cleanRoot = normRoot.replace(/\//g, '\\').toLowerCase();

    const r =
      cleanRoot.length > 3 && cleanRoot.endsWith('\\')
        ? cleanRoot.slice(0, -1)
        : cleanRoot;

    if (cleanTarget === r) {
      return true;
    }

    const prefix = r.endsWith('\\') ? r : `${r}\\`;
    return cleanTarget.startsWith(prefix);
  }

  // POSIX or relative path resolution
  const resolvedTarget = path.resolve(normTarget);
  const resolvedRoot = path.resolve(normRoot);

  if (resolvedTarget === resolvedRoot) {
    return true;
  }

  const prefix = resolvedRoot.endsWith(path.sep) ? resolvedRoot : `${resolvedRoot}${path.sep}`;
  return resolvedTarget.startsWith(prefix);
}

export interface WalkOptions {
  driveTotalBytes?: number | null;
  driveFreeBytes?: number | null;
  maxLargeFiles?: number;
  progressInterval?: number;
  onProgress?: (progress: ScanProgressEvent) => void;
  isCancelled?: () => boolean;
}

interface QueueItem {
  path: string;
  node: DiskFolderNode;
}

/**
 * Performs a read-only directory walk with full handling of:
 * - Reparse points (skips all symlinks and junctions, distinguishing escape vs in-root)
 * - Long paths (>260 chars with \\?\ prefixing, stripped before display)
 * - Permission denied (recorded in skippedPaths, scan continues)
 * - Files vanishing mid-scan (skipped silently)
 * - Realtime progress emission and cancellation support
 */
export async function walk(
  rootPath: string,
  options: WalkOptions = {}
): Promise<DiskAnalysisResult> {
  const startTime = Date.now();
  const maxLargeFiles = options.maxLargeFiles ?? 50;
  const progressInterval = options.progressInterval ?? 1000;
  const { onProgress, isCancelled } = options;

  const skippedPaths: SkippedPath[] = [];
  const categoryStats = new Map<DiskFileType, { totalBytes: number; count: number }>();
  for (const type of [
    'video',
    'audio',
    'image',
    'document',
    'archive',
    'system',
    'other',
  ] as DiskFileType[]) {
    categoryStats.set(type, { totalBytes: 0, count: 0 });
  }

  let scannedBytes = 0;
  let fileCount = 0;
  let directoryCount = 0;
  let complete = true;
  let candidates: LargeFileCandidate[] = [];

  const cleanRootPath = stripExtendedPath(rootPath);

  // Verify access to root path
  let rootStat: fs.Stats;
  try {
    const fsRoot = getFsPath(cleanRootPath);
    rootStat = fs.statSync(fsRoot);
  } catch (err: unknown) {
    const error = err as { code?: string };
    const reason =
      error.code === 'EACCES' || error.code === 'EPERM'
        ? 'permission-denied'
        : error.code === 'ENOENT'
        ? 'not-found'
        : 'stat-error';
    skippedPaths.push({ path: cleanRootPath, reason });
    return assembleDiskAnalysisResult({
      rootPath: cleanRootPath,
      driveTotalBytes: options.driveTotalBytes ?? null,
      driveFreeBytes: options.driveFreeBytes ?? null,
      scannedBytes: 0,
      fileCount: 0,
      directoryCount: 0,
      folderTree: {
        name: cleanRootPath,
        path: cleanRootPath,
        sizeBytes: 0,
        fileCount: 0,
        percentage: 100,
      },
      largeFiles: [],
      breakdown: buildFileTypeBreakdown(categoryStats, 0),
      skippedPaths,
      scanDurationMs: Date.now() - startTime,
      complete: false,
    });
  }

  const rootFolderNode: DiskFolderNode = {
    name: cleanRootPath,
    path: cleanRootPath,
    sizeBytes: 0,
    fileCount: 0,
    percentage: 100,
    children: [],
  };

  const queue: QueueItem[] = [{ path: cleanRootPath, node: rootFolderNode }];

  while (queue.length > 0) {
    if (isCancelled && isCancelled()) {
      complete = false;
      break;
    }

    const current = queue.shift()!;
    let entries: fs.Dirent[];
    let fsCurrentPath: string;

    try {
      fsCurrentPath = getFsPath(current.path);
    } catch {
      skippedPaths.push({ path: stripExtendedPath(current.path), reason: 'stat-error' });
      continue;
    }

    try {
      entries = fs.readdirSync(fsCurrentPath, { withFileTypes: true });
      directoryCount++;
    } catch (err: unknown) {
      const error = err as { code?: string };
      const reason =
        error.code === 'EACCES' || error.code === 'EPERM'
          ? 'permission-denied'
          : error.code === 'ENOENT'
          ? 'not-found'
          : 'stat-error';
      skippedPaths.push({ path: stripExtendedPath(current.path), reason });
      continue;
    }

    for (const entry of entries) {
      if (isCancelled && isCancelled()) {
        complete = false;
        break;
      }

      // Phase 14: Exclude wipe temp file from DiskAnalyzer results
      if (entry.name.toLowerCase() === '$deskkleanwipe.tmp') {
        continue;
      }

      const entryPath = path.join(current.path, entry.name);
      let fsEntryPath: string;
      try {
        fsEntryPath = getFsPath(entryPath);
      } catch {
        skippedPaths.push({ path: stripExtendedPath(entryPath), reason: 'stat-error' });
        continue;
      }

      let lstat: fs.Stats;
      try {
        lstat = fs.lstatSync(fsEntryPath);
      } catch (err: unknown) {
        const error = err as { code?: string };
        if (error.code === 'ENOENT') {
          // File vanished between readdir and lstat — skip silently per spec
          continue;
        }
        const reason =
          error.code === 'EACCES' || error.code === 'EPERM'
            ? 'permission-denied'
            : 'stat-error';
        skippedPaths.push({ path: stripExtendedPath(entryPath), reason });
        continue;
      }

      // Reparse point detection — ALL reparse points are skipped (OQ-11).
      // If it is a symbolic link, resolve with fs.realpathSync and skip it.
      if (lstat.isSymbolicLink()) {
        let resolved: string;
        try {
          resolved = fs.realpathSync(fsEntryPath);
        } catch (err: unknown) {
          const error = err as { code?: string };
          const reason =
            error.code === 'EACCES' || error.code === 'EPERM'
              ? 'permission-denied'
              : error.code === 'ENOENT'
              ? 'not-found'
              : 'stat-error';
          skippedPaths.push({ path: stripExtendedPath(entryPath), reason });
          continue;
        }

        const normResolved = stripExtendedPath(resolved);
        const reason = isPathInsideRoot(normResolved, cleanRootPath)
          ? 'reparse-point-skipped'
          : 'reparse-point-escape';
        skippedPaths.push({ path: stripExtendedPath(entryPath), reason });
        continue;
      }

      if (entry.isDirectory()) {
        // A directory that is not a symlink may still be a junction.
        // fs.realpathSync is called on DIRECTORIES only, never on files.
        let resolved: string;
        try {
          resolved = fs.realpathSync(fsEntryPath);
        } catch (err: unknown) {
          const error = err as { code?: string };
          const reason =
            error.code === 'EACCES' || error.code === 'EPERM'
              ? 'permission-denied'
              : error.code === 'ENOENT'
              ? 'not-found'
              : 'stat-error';
          skippedPaths.push({ path: stripExtendedPath(entryPath), reason });
          continue;
        }

        const normResolved = stripExtendedPath(resolved).replace(/[\\/]+$/, '');
        const normEntry = stripExtendedPath(entryPath).replace(/[\\/]+$/, '');
        const isSameDir =
          process.platform === 'win32'
            ? normResolved.toLowerCase() === normEntry.toLowerCase()
            : normResolved === normEntry;

        if (!isSameDir) {
          // Reparse point / junction — skip it
          const reason = isPathInsideRoot(normResolved, cleanRootPath)
            ? 'reparse-point-skipped'
            : 'reparse-point-escape';
          skippedPaths.push({ path: stripExtendedPath(entryPath), reason });
          continue;
        }

        // Real directory: create child node and enqueue
        const childNode: DiskFolderNode = {
          name: entry.name,
          path: stripExtendedPath(entryPath),
          sizeBytes: 0,
          fileCount: 0,
          percentage: 0,
          children: [],
        };
        if (!current.node.children) {
          current.node.children = [];
        }
        current.node.children.push(childNode);
        queue.push({ path: entryPath, node: childNode });
      } else if (entry.isFile()) {
        let stat: fs.Stats;
        try {
          stat = fs.statSync(fsEntryPath);
        } catch (err: unknown) {
          const error = err as { code?: string };
          if (error.code === 'ENOENT') {
            // File vanished between readdir and stat — skip silently per spec
            continue;
          }
          const reason =
            error.code === 'EACCES' || error.code === 'EPERM'
              ? 'permission-denied'
              : 'stat-error';
          skippedPaths.push({ path: stripExtendedPath(entryPath), reason });
          continue;
        }

        const fileSize = stat.size;
        fileCount++;
        scannedBytes += fileSize;

        // Aggregate into current folder
        current.node.sizeBytes += fileSize;
        current.node.fileCount++;

        // Aggregate into category breakdown
        const ext = path.extname(entry.name);
        const category = extensionToCategory(ext);
        const catStat = categoryStats.get(category)!;
        catStat.totalBytes += fileSize;
        catStat.count++;

        // Track large file candidate
        candidates.push({
          name: entry.name,
          path: stripExtendedPath(entryPath),
          sizeBytes: fileSize,
          extension: ext.replace(/^\./, '').toLowerCase(),
          lastModified: stat.mtime.toISOString(),
        });

        // Bounded pruning of large files list to keep memory usage low
        if (candidates.length > maxLargeFiles * 3) {
          candidates.sort((a, b) => b.sizeBytes - a.sizeBytes);
          candidates = candidates.slice(0, maxLargeFiles * 2);
        }

        // Realtime progress reporting
        if (fileCount % progressInterval === 0) {
          onProgress?.({
            filesScanned: fileCount,
            directoriesScanned: directoryCount,
            bytesCounted: scannedBytes,
            currentPath: stripExtendedPath(entryPath),
          });
          // Yield to event loop to allow IPC events (cancel) and UI rendering
          await new Promise<void>((resolve) => setImmediate(resolve));
        }
      }
    }
  }

  // Finalize aggregated sizes, percentages, breakdown, and top-N large files
  finalizeFolderTree(rootFolderNode, scannedBytes);
  const breakdown = buildFileTypeBreakdown(categoryStats, scannedBytes);
  const largeFiles = finalizeLargeFiles(candidates, maxLargeFiles);
  const scanDurationMs = Date.now() - startTime;

  return assembleDiskAnalysisResult({
    rootPath: cleanRootPath,
    driveTotalBytes: options.driveTotalBytes ?? null,
    driveFreeBytes: options.driveFreeBytes ?? null,
    scannedBytes,
    fileCount,
    directoryCount,
    folderTree: rootFolderNode,
    largeFiles,
    breakdown,
    skippedPaths,
    scanDurationMs,
    complete,
  });
}
