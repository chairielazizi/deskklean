import fs from 'fs';
import path from 'path';
import {
  OperationPlan,
  PlannedAction,
  BlockedAction,
} from './framework/types';
import { createOperationPlan } from './framework/plan';
import { validatePath } from './framework/protected';
import {
  getPhysicalDisks,
  getPartitions,
  getLogicalDisks,
  MSFT_PhysicalDisk,
  MSFT_Partition,
  Win32_LogicalDisk,
} from './cim';
import { toNumber } from './parse';

// Pass count constraints (Phase 14 D2)
export const MIN_PASS_COUNT = 1;
export const MAX_PASS_COUNT = 3;

/**
 * Validates pass count strictly: must be an integer between 1 and 3.
 */
export function isValidPassCount(passes: unknown): boolean {
  return typeof passes === 'number' && Number.isInteger(passes) && passes >= MIN_PASS_COUNT && passes <= MAX_PASS_COUNT;
}

/**
 * Asserts pass count is valid integer 1-3, throwing immediately if invalid.
 */
export function assertValidPassCount(passes: unknown): number {
  if (typeof passes !== 'number' || !Number.isInteger(passes)) {
    throw new Error(`Invalid pass count: ${passes}. Pass count must be an integer between 1 and 3.`);
  }
  if (passes < MIN_PASS_COUNT) {
    throw new Error(`Invalid pass count: ${passes}. Pass count must be at least 1.`);
  }
  if (passes > MAX_PASS_COUNT) {
    throw new Error(`Invalid pass count: ${passes}. Pass count cannot exceed 3.`);
  }
  return passes;
}

// Open-file probe & classification (Phase 14 D3, OQ-SE-1)
export type OpenFileProbeResult = 'clear' | 'locked' | 'indeterminate' | 'not-found';

export type OpenFileProbe = (filePath: string) => Promise<OpenFileProbeResult> | OpenFileProbeResult;

/**
 * Pure classification of an open-file probe result.
 * Rail: A probe failure is indeterminate — never silently treated as "clear".
 */
export function classifyOpenFile(probeResult: OpenFileProbeResult): { isBlocked: boolean; reason?: string } {
  switch (probeResult) {
    case 'clear':
      return { isBlocked: false };
    case 'locked':
      return { isBlocked: true, reason: 'file is in use' };
    case 'indeterminate':
      return { isBlocked: true, reason: 'file access is indeterminate' };
    case 'not-found':
      return { isBlocked: true, reason: 'file does not exist' };
    default:
      return { isBlocked: true, reason: 'file access is indeterminate' };
  }
}

/**
 * Default probe attempting exclusive read-write open on the file.
 * Note: Handle semantics are platform-specific (Windows-only for exclusive locking).
 */
export async function defaultOpenFileProbe(filePath: string): Promise<OpenFileProbeResult> {
  try {
    const handle = await fs.promises.open(filePath, 'r+');
    await handle.close();
    return 'clear';
  } catch (err: unknown) {
    const error = err as { code?: string };
    if (error?.code === 'ENOENT') {
      return 'not-found';
    }
    if (error?.code === 'EBUSY' || error?.code === 'EPERM' || error?.code === 'EACCES') {
      return 'locked';
    }
    return 'indeterminate';
  }
}

// Free-space wiping thresholds & headroom (Phase 14 D4)
export const MIN_FREE_SPACE_BYTES = 100 * 1024 * 1024; // 100 MB
export const MIN_HEADROOM_FLOOR_BYTES = 1024 * 1024 * 1024; // 1 GB
export const WIPE_TEMP_FILE_NAME = '$DeskKleanWipe.tmp';

/**
 * Calculates the threshold below which free space is refused.
 * Rule: max(1% of volume, 100 MB).
 */
export function calculateFreeSpaceThreshold(volumeTotalBytes: number): number {
  return Math.max(Math.floor(volumeTotalBytes * 0.01), MIN_FREE_SPACE_BYTES);
}

/**
 * Checks free space against threshold.
 * Rail: Refusal reason must say what was actually true:
 * "Free space is below the minimum worth wiping (X MB). Nothing was overwritten."
 * Never "insufficient free space".
 */
export function checkFreeSpaceThreshold(
  volumeTotalBytes: number,
  volumeFreeBytes: number
): {
  allowed: boolean;
  thresholdBytes: number;
  refusalReason?: string;
} {
  const thresholdBytes = calculateFreeSpaceThreshold(volumeTotalBytes);
  if (volumeFreeBytes < thresholdBytes) {
    const thresholdMb = Math.round(thresholdBytes / (1024 * 1024));
    return {
      allowed: false,
      thresholdBytes,
      refusalReason: `Free space is below the minimum worth wiping (${thresholdMb} MB). Nothing was overwritten.`,
    };
  }
  return {
    allowed: true,
    thresholdBytes,
  };
}

/**
 * Calculates headroom floor to leave on disk.
 * Rule: max(1 GB, 5% of volume).
 */
export function calculateHeadroomFloor(volumeTotalBytes: number): number {
  return Math.max(MIN_HEADROOM_FLOOR_BYTES, Math.floor(volumeTotalBytes * 0.05));
}

/**
 * Calculates target wipe byte count leaving headroom floor.
 * A wipe that stops early is a partial result, reported as partial.
 */
export function calculateWipeTargetBytes(
  volumeTotalBytes: number,
  volumeFreeBytes: number
): {
  wipeBytes: number;
  headroomFloorBytes: number;
  isPartial: boolean;
} {
  const headroomFloorBytes = calculateHeadroomFloor(volumeTotalBytes);
  const wipeBytes = Math.max(0, volumeFreeBytes - headroomFloorBytes);
  return {
    wipeBytes,
    headroomFloorBytes,
    isPartial: true,
  };
}

/**
 * Returns the deterministic temp file path for a volume.
 */
export function getWipeTempFilePath(volumeRoot: string): string {
  const normalized = volumeRoot.endsWith('\\') || volumeRoot.endsWith('/')
    ? volumeRoot
    : `${volumeRoot}\\`;
  return path.join(normalized, WIPE_TEMP_FILE_NAME);
}

/**
 * Sweeps leftover $DeskKleanWipe.tmp files on startup across drives.
 */
export async function sweepLeftoverWipeFiles(volumeRoots?: string[]): Promise<string[]> {
  const removed: string[] = [];
  const roots = volumeRoots || (process.platform === 'win32' ? ['C:\\', 'D:\\', 'E:\\'] : []);
  for (const root of roots) {
    try {
      const tempPath = getWipeTempFilePath(root);
      if (fs.existsSync(tempPath)) {
        await fs.promises.unlink(tempPath);
        removed.push(tempPath);
      }
    } catch {
      // Ignored during startup sweep
    }
  }
  return removed;
}

// Irreversibility declarations (Phase 14 D5)
export const SHRED_IRREVERSIBILITY_REASON =
  'Overwriting destroys the original bytes. The file cannot be restored from a backup because no backup is made — the backup would contain the very data the shred is meant to destroy.';

export const WIPE_IRREVERSIBILITY_REASON =
  'Overwriting destroys the original bytes in free space. The file cannot be restored from a backup because no backup is made — the backup would contain the very data the wipe is meant to destroy.';

// SSD Honesty Detection (Phase 14 OQ-SE-3)
export interface SsdDetectionRunners {
  getPhysicalDisksFn?: () => Promise<MSFT_PhysicalDisk[]>;
  getPartitionsFn?: () => Promise<MSFT_Partition[]>;
}

/**
 * Detects whether the drive hosting volumeRootOrPath is an SSD vs HDD.
 * Returns true for SSD (MediaType 4), false for HDD (MediaType 3), or null if indeterminate.
 * Rail: If unavailable at runtime, returns null and SSD honesty notice is shown by default.
 */
export async function isTargetSsd(
  volumeRootOrPath: string,
  runners?: SsdDetectionRunners
): Promise<boolean | null> {
  try {
    if (process.platform !== 'win32' && !runners) {
      return null;
    }
    const cleanLetterMatch = volumeRootOrPath.match(/^([a-zA-Z]):/);
    const driveLetter = cleanLetterMatch ? cleanLetterMatch[1].toUpperCase() : 'C';

    const [partitions, physicalDisks] = await Promise.all([
      runners?.getPartitionsFn ? runners.getPartitionsFn() : getPartitions({ timeoutMs: 5000 }),
      runners?.getPhysicalDisksFn ? runners.getPhysicalDisksFn() : getPhysicalDisks({ timeoutMs: 5000 }),
    ]);

    const part = partitions.find(
      (p) => p.DriveLetter && p.DriveLetter.trim().toUpperCase() === driveLetter
    );
    const diskNumber = part?.DiskNumber !== null && part?.DiskNumber !== undefined ? part.DiskNumber : null;
    const physDisk =
      diskNumber !== null
        ? physicalDisks.find(
            (pd) =>
              pd.DeviceId !== null &&
              pd.DeviceId !== undefined &&
              String(pd.DeviceId).trim() === String(diskNumber)
          )
        : physicalDisks.length === 1
        ? physicalDisks[0]
        : null;

    if (physDisk && physDisk.MediaType !== null && physDisk.MediaType !== undefined) {
      if (physDisk.MediaType === 4) return true; // SSD
      if (physDisk.MediaType === 3) return false; // HDD
    }
    return null;
  } catch {
    return null;
  }
}

// Plan creation options
export interface ShredPlanOptions {
  probeFn?: OpenFileProbe;
  statFn?: (p: string) => fs.Stats;
  existsSyncFn?: (p: string) => boolean;
  realpathSyncFn?: (p: string) => string;
}

export interface FreeSpaceWipePlanOptions {
  volumeTotalBytes?: number;
  volumeFreeBytes?: number;
}

/**
 * Creates an OperationPlan for secure file shredding.
 * Rejects invalid pass counts before any handling.
 * Checks open files with injectable probe and reports blocked items.
 */
export async function createShredPlan(
  targetPaths: string[],
  passes: number,
  options?: ShredPlanOptions
): Promise<OperationPlan> {
  // Validate pass count at the plan boundary BEFORE any handling (Rail 3)
  const validPasses = assertValidPassCount(passes);

  const actions: PlannedAction[] = [];
  const blocked: BlockedAction[] = [];

  const probe = options?.probeFn ?? defaultOpenFileProbe;
  const existsSync = options?.existsSyncFn ?? fs.existsSync;
  const statSync = options?.statFn ?? fs.statSync;

  for (let i = 0; i < targetPaths.length; i++) {
    const rawPath = targetPaths[i];
    if (!rawPath || typeof rawPath !== 'string') {
      blocked.push({ target: String(rawPath), reason: 'Invalid or empty path' });
      continue;
    }

    const resolvedPath = path.resolve(rawPath);

    if (!existsSync(resolvedPath)) {
      blocked.push({ target: resolvedPath, reason: 'File does not exist' });
      continue;
    }

    // Framework path validation
    const pathVal = validatePath(resolvedPath, { allowNonExistent: false });
    if (!pathVal.allowed) {
      blocked.push({ target: resolvedPath, reason: pathVal.reason || 'Protected path refused' });
      continue;
    }

    // Open-file check
    const probeResult = await probe(resolvedPath);
    const classification = classifyOpenFile(probeResult);
    if (classification.isBlocked) {
      blocked.push({ target: resolvedPath, reason: classification.reason || 'file is in use' });
      continue;
    }

    try {
      const stat = statSync(resolvedPath);
      if (stat.isDirectory()) {
        blocked.push({ target: resolvedPath, reason: 'Cannot shred directory: overwrite-file applies only to files' });
        continue;
      }

      actions.push({
        id: `shred-${actions.length + 1}`,
        kind: 'overwrite-file',
        target: resolvedPath,
        description: `Secure overwrite (${validPasses} pass${validPasses > 1 ? 'es' : ''}) and delete ${path.basename(resolvedPath)}`,
        reclaimableBytes: stat.size,
        metadata: {
          passes: validPasses,
          fileSize: stat.size,
        },
      });
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      blocked.push({ target: resolvedPath, reason: `Failed to stat file: ${errorMsg}` });
    }
  }

  return createOperationPlan({
    module: 'secure-erase',
    actions,
    blocked,
    reversibility: 'irreversible',
    irreversibilityReason: SHRED_IRREVERSIBILITY_REASON,
    requiresElevation: false,
  });
}

/**
 * Creates an OperationPlan for free space wiping.
 * Refuses if free space is below the minimum worth wiping with an honest reason.
 * Calculates headroom floor and sets max wipe bytes.
 */
export async function createFreeSpaceWipePlan(
  volumeRoot: string,
  options?: FreeSpaceWipePlanOptions
): Promise<OperationPlan> {
  const normRoot = volumeRoot.includes(':')
    ? (volumeRoot.endsWith('\\') || volumeRoot.endsWith('/') ? volumeRoot : `${volumeRoot}\\`)
    : `${volumeRoot}:\\`;

  let totalBytes = options?.volumeTotalBytes;
  let freeBytes = options?.volumeFreeBytes;

  if (totalBytes === undefined || freeBytes === undefined) {
    try {
      const disks = await getLogicalDisks({ timeoutMs: 5000 });
      const letter = normRoot.replace(/[^a-zA-Z]/g, '')[0]?.toUpperCase() || 'C';
      const disk = disks.find((d: Win32_LogicalDisk) => {
        const dLetter = (d.DeviceID || '').replace(/[^a-zA-Z]/g, '').toUpperCase();
        return dLetter === letter;
      });
      if (disk) {
        const rawTotal = toNumber(disk.Size);
        const rawFree = toNumber(disk.FreeSpace);
        if (rawTotal !== null) totalBytes = rawTotal;
        if (rawFree !== null) freeBytes = rawFree;
      }
    } catch {
      // Fallback if disk query fails
    }
  }

// If sizes could not be determined, refuse rather than inventing free-space values.
  if (totalBytes === undefined || freeBytes === undefined) {
    const refusalReason = 'Volume size and free space could not be determined from the system. Nothing was overwritten because the amount of work could not be measured.';
    return createOperationPlan({
      module: 'secure-erase',
      actions: [],
      blocked: [
        {
          target: normRoot,
          reason: refusalReason,
        },
      ],
      reversibility: 'irreversible',
      irreversibilityReason: WIPE_IRREVERSIBILITY_REASON,
      requiresElevation: false,
    });
  }

  // Free-space threshold check (D4)
  const thresholdCheck = checkFreeSpaceThreshold(totalBytes, freeBytes);
  if (!thresholdCheck.allowed) {
    return createOperationPlan({
      module: 'secure-erase',
      actions: [],
      blocked: [
        {
          target: normRoot,
          reason: thresholdCheck.refusalReason!,
        },
      ],
      reversibility: 'irreversible',
      irreversibilityReason: WIPE_IRREVERSIBILITY_REASON,
      requiresElevation: false,
    });
  }

  const { wipeBytes, headroomFloorBytes } = calculateWipeTargetBytes(totalBytes, freeBytes);
  const tempPath = getWipeTempFilePath(normRoot);

  const actions: PlannedAction[] = [
    {
      id: `wipe-${Date.now()}`,
      kind: 'overwrite-file',
      target: tempPath,
      description: `Wipe free space on ${normRoot} (${wipeBytes} bytes, leaving ${headroomFloorBytes} bytes headroom)`,
      reclaimableBytes: null, // Wipe reclaims nothing
      metadata: {
        isFreeSpaceWipe: true,
        volumeRoot: normRoot,
        maxWipeBytes: wipeBytes,
        headroomFloorBytes,
        totalBytes,
        freeBytes,
        passes: 1,
      },
    },
  ];

  return createOperationPlan({
    module: 'secure-erase',
    actions,
    blocked: [],
    reversibility: 'irreversible',
    irreversibilityReason: WIPE_IRREVERSIBILITY_REASON,
    requiresElevation: false,
  });
}
