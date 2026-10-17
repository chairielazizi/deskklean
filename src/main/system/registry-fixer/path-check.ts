import fs from 'fs';
import { queryCim, Win32_LogicalDisk } from '../cim';
import { isWindows } from '../powershell';
import { PathCheckOutcome } from '../../../shared/types';

/**
 * Windows DriveType constants:
 * 0: DRIVE_UNKNOWN
 * 1: DRIVE_NO_ROOT_DIR
 * 2: DRIVE_REMOVABLE
 * 3: DRIVE_FIXED
 * 4: DRIVE_REMOTE (network drive)
 * 5: DRIVE_CDROM
 * 6: DRIVE_RAMDISK
 */
export const DRIVE_REMOTE = 4;

/**
 * Global cache for drive letter to Win32_LogicalDisk DriveType mapping.
 * Maps uppercase drive letter (e.g. 'C', 'Z') to DriveType (or null if absent/unresolved).
 */
const globalDriveTypeCache = new Map<string, number | null>();

/**
 * Clears the global drive type cache (useful between scans or in tests).
 */
export function clearDriveTypeCache(): void {
  globalDriveTypeCache.clear();
}

/**
 * Normalizes and strips outer quotes or leading/trailing whitespace from a path string.
 */
export function cleanPath(rawPath: string): string {
  if (typeof rawPath !== 'string') return '';
  let cleaned = rawPath.trim();
  if (
    (cleaned.startsWith('"') && cleaned.endsWith('"')) ||
    (cleaned.startsWith("'") && cleaned.endsWith("'"))
  ) {
    cleaned = cleaned.slice(1, -1).trim();
  }
  return cleaned;
}

/**
 * Checks whether a path starts with a UNC network prefix (\\ or //).
 */
export function isUncPath(targetPath: string): boolean {
  const cleaned = cleanPath(targetPath);
  return cleaned.startsWith('\\\\') || cleaned.startsWith('//');
}

export interface NetworkPathOptions {
  driveTypeCache?: Map<string, number | null>;
  lookupDriveType?: (driveLetter: string) => Promise<number | null>;
}

/**
 * Default lookup for a drive letter's DriveType via CIM Win32_LogicalDisk.
 */
async function defaultLookupDriveType(driveLetter: string): Promise<number | null> {
  if (!isWindows()) {
    return null;
  }
  try {
    const disks = await queryCim<Win32_LogicalDisk>('Win32_LogicalDisk', {
      filter: `DeviceID = '${driveLetter}:'`,
      properties: ['DeviceID', 'DriveType'],
      timeoutMs: 5000,
    });
    if (disks.length > 0 && disks[0].DriveType !== null && disks[0].DriveType !== undefined) {
      return Number(disks[0].DriveType);
    }
    return null;
  } catch (err) {
    console.warn(`Failed to query CIM for drive ${driveLetter}:`, err);
    return null;
  }
}

/**
 * Detects whether a path lives on a network.
 * Returns true if:
 * - UNC prefix (\\ or //)
 * - Mapped network drive resolved via a cached per-drive-letter Win32_LogicalDisk lookup (DriveType = 4)
 * Does NOT assume every non-C: letter is remote.
 */
export async function isNetworkPath(
  targetPath: string,
  options?: NetworkPathOptions
): Promise<boolean> {
  const cleaned = cleanPath(targetPath);
  if (!cleaned) return false;

  // 1. UNC prefix
  if (isUncPath(cleaned)) {
    return true;
  }

  // 2. Drive letter check
  const driveMatch = cleaned.match(/^([a-zA-Z]):/);
  if (!driveMatch) {
    return false;
  }

  const driveLetter = driveMatch[1].toUpperCase();
  const cache = options?.driveTypeCache ?? globalDriveTypeCache;

  if (cache.has(driveLetter)) {
    const cached = cache.get(driveLetter);
    return cached === DRIVE_REMOTE;
  }

  const lookup = options?.lookupDriveType ?? defaultLookupDriveType;
  const driveType = await lookup(driveLetter);
  cache.set(driveLetter, driveType);

  return driveType === DRIVE_REMOTE;
}

export interface PathCheckOptions {
  statFn?: (p: string) => Promise<unknown>;
}

/**
 * Performs the three-outcome filesystem existence check.
 *
 * Outcomes:
 * - 'exists': The path exists and was stat'd successfully
 * - 'gone': The path is provably absent (ENOENT and NOTHING else)
 * - 'indeterminate': The check could not complete (EACCES, EPERM, EIO, ENOTDIR, network timeout, etc.)
 *
 * fs.existsSync is banned because it collapses 'gone' and 'indeterminate' into false.
 */
export async function checkPathOutcome(
  targetPath: string,
  options?: PathCheckOptions
): Promise<PathCheckOutcome> {
  const cleaned = cleanPath(targetPath);
  if (!cleaned) {
    return 'indeterminate';
  }

  const stat = options?.statFn ?? fs.promises.stat;

  try {
    await stat(cleaned);
    return 'exists';
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code;
    if (code === 'ENOENT') {
      return 'gone';
    }
    return 'indeterminate';
  }
}
