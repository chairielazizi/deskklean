import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { runPowerShell, isWindows } from '../powershell';
import { readValue, buildRegSnippet, decodeStartupApproved, keyExists, RegistryHive, ReadValueResult } from '../registry';
import { isElevated } from '../elevation';
import { getOperationPlan, removeOperationPlan } from './plan';
import {
  writeRegBackupFile,
  writeFileBackupManifest,
  readBackupFileText,
  parseRegMetadata,
  getModuleBackupDir,
} from './backup';
import { ExecuteResult, PlannedAction, ExecuteFailure } from './types';
import { isFileInUseError } from '../smartclean/scan';
import {
  formatRegistryFixerBackup,
  writeRegistryFixerBackupFile,
  validateRegBackupFile,
  readSubKeyValuesWithTypes,
  slugify,
  RegistryBackupEntry,
  BackupValidationResult,
} from '../registry-fixer/backup';
import {
  waitForProcessTree,
  checkPendingReboot,
  verifyAppRemoved,
  getAllInstalledApps,
} from '../appRemover';
import { InstalledApp } from '../../../shared/types';

export interface RegistryExecutionRunners {
  isWindowsFn?: () => boolean;
  isElevatedFn?: () => Promise<boolean>;
  keyExistsFn?: (hive: RegistryHive, keyPath: string) => Promise<boolean>;
  readValueFn?: (hive: RegistryHive, keyPath: string, valueName: string) => Promise<ReadValueResult>;
  readSubKeyValuesWithTypesFn?: (hive: RegistryHive, keyPath: string) => Promise<Array<{ name: string; type: string; data: unknown }>>;
  deleteKeyFn?: (hive: RegistryHive, keyPath: string) => Promise<void>;
  deleteValueFn?: (hive: RegistryHive, keyPath: string, valueName: string) => Promise<void>;
  writeBackupFn?: (filePath: string, content: string) => void;
  validateBackupFn?: (filePath: string) => BackupValidationResult;
  backupDirOverride?: string;
}

export interface FileExecutionRunners {
  isWindowsFn?: () => boolean;
  isElevatedFn?: () => Promise<boolean>;
  backupDirOverride?: string;
  trashItemFn?: (target: string) => Promise<void>;
  powershellRecycleFn?: (target: string, isDirectory: boolean) => Promise<void>;
  unlinkFn?: (target: string) => Promise<void>;
  rmDirFn?: (target: string) => Promise<void>;
  randomBytesFn?: (size: number) => Buffer;
}

export interface UninstallExecutionRunners {
  isWindowsFn?: () => boolean;
  isElevatedFn?: () => Promise<boolean>;
  backupDirOverride?: string;
  fileExistsFn?: (path: string) => boolean;
  spawnProcessFn?: (
    executable: string,
    args: string[],
    isInteractive: boolean
  ) => Promise<{ pid: number; exitCodePromise?: Promise<number> }>;
  waitForProcessTreeFn?: (
    pid: number,
    options?: { timeoutMs?: number }
  ) => Promise<{ timedOut: boolean; allPids: number[] }>;
  reEnumerateFn?: () => Promise<InstalledApp[]>;
  checkPendingRebootFn?: () => Promise<boolean>;
  runPowerShellFn?: (script: string) => Promise<string>;
}

export type ExecutionRunners = RegistryExecutionRunners & FileExecutionRunners & UninstallExecutionRunners;

/**
 * Executes a planned destructive operation (such as restoring a registry backup).
 *
 * Enforces Phase 3 contract rails:
 * 1. Checks elevation before touching anything.
 * 2. Backs up current state before the first destructive call; aborts if backup fails.
 * 3. Atomic execution: runs the restore or deletion.
 * 4. Verification: re-reads the registry or filesystem to confirm intended state.
 * 5. Record: records confirmed result in activity log.
 */
export async function executeOperationPlan(
  planId: string,
  logActivity?: (item: {
    module: string;
    title: string;
    detail: string;
    type: 'info' | 'success' | 'warning' | 'error';
    spaceFreedBytes?: number;
  }) => void,
  runners?: ExecutionRunners
): Promise<ExecuteResult> {
  const plan = getOperationPlan(planId);
  if (!plan) {
    return {
      success: false,
      completed: 0,
      failed: 1,
      skipped: 0,
      reclaimableBytes: null,
      failures: [{ target: planId, error: 'Operation plan not found or expired' }],
      message: 'Operation plan not found or expired. Please re-plan and try again.',
    };
  }

  // 1. Elevation check before touching anything
  if (plan.requiresElevation) {
    const elevated = runners?.isElevatedFn ? await runners.isElevatedFn() : await isElevated();
    if (!elevated) {
      return {
        success: false,
        completed: 0,
        failed: plan.actions.length,
        skipped: 0,
        reclaimableBytes: null,
        failures: [
          {
            target: plan.module,
            error: 'Administrator rights are required to execute this operation',
          },
        ],
        message: 'Administrator rights are required to execute this operation.',
      };
    }
  }

  const isWin = runners?.isWindowsFn ? runners.isWindowsFn() : isWindows();
  if (!isWin) {
    return {
      success: false,
      completed: 0,
      failed: plan.actions.length,
      skipped: 0,
      reclaimableBytes: null,
      failures: [{ target: plan.module, error: 'Operations are only supported on Windows' }],
      message: 'Operations are only supported on Windows.',
    };
  }

  // Handle Registry Restore Plan
  const restoreAction = plan.actions.find(
    (a) => a.kind === 'registry-value' && a.metadata?.isRestore === true
  );

  if (restoreAction && restoreAction.metadata?.backupFilePath) {
    return executeRegistryRestore(plan, restoreAction, logActivity);
  }

  // Handle Registry Deletions (Phase 8 Registry Fixer)
  const hasRegistryDeletions = plan.actions.some(
    (a) => a.kind === 'registry-key' || a.kind === 'registry-value'
  );

  if (hasRegistryDeletions) {
    return executeRegistryDeletions(plan, logActivity, runners);
  }

  // Handle Overwrite / Shred File Plan (Phase 14 Secure Erase)
  const hasOverwriteFiles = plan.actions.some(
    (a) => a.kind === 'overwrite-file'
  );

  if (hasOverwriteFiles) {
    return executeOverwriteFiles(plan, logActivity, runners);
  }

  // Handle File / Tree Deletion Plan (e.g. SmartClean)
  const hasFileDeletions = plan.actions.some(
    (a) => a.kind === 'delete-file' || a.kind === 'delete-tree'
  );

  if (hasFileDeletions) {
    return executeFileDeletions(plan, logActivity, runners);
  }

  // Handle App Uninstall Plan (Phase 12 App Remover)
  const hasUninstallActions = plan.actions.some((a) => a.kind === 'uninstall');
  if (hasUninstallActions) {
    return executeUninstallActions(plan, logActivity, runners);
  }

  return {
    success: false,
    completed: 0,
    failed: plan.actions.length,
    skipped: 0,
    reclaimableBytes: null,
    failures: [{ target: plan.module, error: 'Unsupported action kind in execution framework' }],
    message: 'Unsupported action kind.',
  };
}

/**
 * Executes a file or directory tree deletion plan through the framework pipeline:
 * 1. Writes a backup manifest to the shared backup store before the first destructive call; aborts if backup fails.
 * 2. Iterates actions: skips locked files in use (never forced), moves user data to Recycle Bin, deletes permanent items.
 * 3. Verifies each action by re-reading the filesystem; reports success only when verified.
 * 4. Logs confirmed outcome to activity log.
 * 5. Returns partial-failure aware ExecuteResult.
 */
export async function executeFileDeletions(
  plan: import('./types').OperationPlan,
  logActivity?: (item: any) => void,
  runners?: FileExecutionRunners
): Promise<ExecuteResult> {
  // 1. Write backup manifest before first destructive call (Phase 3 rail)
  const backupDir = runners?.backupDirOverride ?? getModuleBackupDir(plan.module);
  const isoTimestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const manifestPath = path.join(backupDir, `${isoTimestamp}-manifest.json`);

  try {
    writeFileBackupManifest(manifestPath, {
      planId: plan.id,
      module: plan.module,
      timestamp: new Date().toISOString(),
      reversibility: plan.reversibility,
      irreversibilityReason: plan.irreversibilityReason,
      totalReclaimableBytes: plan.totalReclaimableBytes,
      actions: plan.actions.map((a) => ({
        id: a.id,
        kind: a.kind,
        target: a.target,
        description: a.description,
        reclaimableBytes: a.reclaimableBytes,
        metadata: a.metadata,
      })),
    });
  } catch (err) {
    return {
      success: false,
      completed: 0,
      failed: plan.actions.length,
      skipped: 0,
      reclaimableBytes: null,
      failures: [
        {
          target: manifestPath,
          error: `Backup manifest creation failed: ${err instanceof Error ? err.message : String(err)}`,
        },
      ],
      message: 'Backup manifest failed before execution; no changes were made.',
    };
  }

  // 2. Perform deletions and verify
  let completed = 0;
  let failed = 0;
  let skipped = 0;
  let freedBytes = 0;
  const failures: { target: string; error: string }[] = [];

  for (const action of plan.actions) {
    const deletionMethod = (action.metadata?.deletionMethod as string) || 'permanent';
    const strategy = action.metadata?.strategy as string | undefined;

    // Special category: Recycle Bin (empty via PowerShell)
    if (strategy === 'shell' || action.metadata?.categoryId === 'recycle-bin') {
      try {
        await runPowerShell('Clear-RecycleBin -Force -ErrorAction Stop');
        completed++;
        if (typeof action.reclaimableBytes === 'number') {
          freedBytes += action.reclaimableBytes;
        }
      } catch (err) {
        failures.push({
          target: action.target,
          error: `Failed to empty Recycle Bin: ${err instanceof Error ? err.message : String(err)}`,
        });
        failed++;
      }
      continue;
    }

    // Special category: System Restore (delete shadow copies via vssadmin)
    if (strategy === 'vss' || action.metadata?.categoryId === 'system-restore') {
      try {
        await runPowerShell('vssadmin delete shadows /all /quiet');
        completed++;
        if (typeof action.reclaimableBytes === 'number') {
          freedBytes += action.reclaimableBytes;
        }
      } catch (err) {
        failures.push({
          target: action.target,
          error: `vssadmin delete shadows failed: ${err instanceof Error ? err.message : String(err)}`,
        });
        failed++;
      }
      continue;
    }

    // Standard filesystem target
    if (!fs.existsSync(action.target)) {
      completed++;
      if (typeof action.reclaimableBytes === 'number') {
        freedBytes += action.reclaimableBytes;
      }
      continue;
    }

    // If file is in use / locked: skip and report, never force
    try {
      if (action.kind === 'delete-file') {
        const handle = await fs.promises.open(action.target, 'r+');
        await handle.close();
      }
    } catch (err) {
      if (isFileInUseError(err)) {
        skipped++;
        continue;
      }
    }

    // Deletion execution
    try {
      if (deletionMethod === 'recycle-bin') {
        let trashSuccess = false;

        // Primary: electron.shell.trashItem (native C++ via COM IFileOperation, 0 process spawns)
        try {
          if (runners?.trashItemFn) {
            await runners.trashItemFn(action.target);
            trashSuccess = true;
          } else {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const electron = require('electron');
            if (electron?.shell?.trashItem) {
              await electron.shell.trashItem(action.target);
              trashSuccess = true;
            }
          }
        } catch {
          trashSuccess = false;
        }

        // Fallback: PowerShell [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile
        // with UIOption.OnlyErrorDialogs and RecycleOption.SendToRecycleBin (OQ-DF-2)
        if (!trashSuccess) {
          try {
            if (runners?.powershellRecycleFn) {
              const isDir =
                fs.existsSync(action.target) &&
                (await fs.promises.stat(action.target)).isDirectory();
              await runners.powershellRecycleFn(action.target, isDir);
              trashSuccess = true;
            } else {
              const isDir =
                fs.existsSync(action.target) &&
                (await fs.promises.stat(action.target)).isDirectory();
              const psMethod = isDir ? 'DeleteDirectory' : 'DeleteFile';
              const escapedPath = action.target.replace(/'/g, "''");
              const psScript = `Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::${psMethod}('${escapedPath}', [Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs, [Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin)`;
              await runPowerShell(psScript);
              trashSuccess = true;
            }
          } catch {
            trashSuccess = false;
          }
        }

        // BINDING RAIL: NEVER call unlink() when deletionMethod === 'recycle-bin'.
        // If both primary trashItem and PowerShell fallback fail, the operation fails closed.
        if (!trashSuccess) {
          throw new Error(
            'Failed to send item to Recycle Bin (both trashItem and PowerShell fallback failed)'
          );
        }
      } else {
        // Permanent deletion (only when deletionMethod !== 'recycle-bin')
        if (action.kind === 'delete-file') {
          if (runners?.unlinkFn) {
            await runners.unlinkFn(action.target);
          } else {
            await fs.promises.unlink(action.target);
          }
        } else if (action.kind === 'delete-tree') {
          const stat = await fs.promises.stat(action.target);
          if (stat.isDirectory()) {
            if (runners?.rmDirFn) {
              await runners.rmDirFn(action.target);
            } else {
              await fs.promises.rm(action.target, { recursive: true, force: true });
            }
          } else {
            if (runners?.unlinkFn) {
              await runners.unlinkFn(action.target);
            } else {
              await fs.promises.unlink(action.target);
            }
          }
        }
      }
    } catch (err) {
      if (isFileInUseError(err)) {
        skipped++;
        continue;
      }
      failures.push({
        target: action.target,
        error: `Delete failed: ${err instanceof Error ? err.message : String(err)}`,
      });
      failed++;
      continue;
    }

    // Step 3: Verify by read-back
    if (fs.existsSync(action.target)) {
      failures.push({
        target: action.target,
        error: 'Verification failed: target still exists on disk after deletion',
      });
      failed++;
    } else {
      completed++;
      if (typeof action.reclaimableBytes === 'number') {
        freedBytes += action.reclaimableBytes;
      }
    }
  }

  // 4. Record confirmed outcome
  if (logActivity) {
    const isAllSuccess = completed === plan.actions.length && failed === 0;
    logActivity({
      module: plan.module,
      title: isAllSuccess ? 'Cleanup Completed' : 'Cleanup Completed (Partial)',
      detail: `Cleaned ${completed} of ${plan.actions.length} items (${freedBytes} bytes freed). ${failed} failed, ${skipped} skipped (in use). Backup manifest: ${path.basename(manifestPath)}`,
      type: isAllSuccess ? 'success' : failed > 0 ? 'warning' : 'info',
      spaceFreedBytes: freedBytes,
    });
  }

  removeOperationPlan(plan.id);

  const success = completed === plan.actions.length && failed === 0;

  return {
    success,
    completed,
    failed,
    skipped,
    reclaimableBytes: freedBytes,
    failures,
    backupPath: manifestPath,
    message: success
      ? `Successfully cleaned ${completed} items.`
      : `Cleaned ${completed} of ${plan.actions.length} items (${failed} failed, ${skipped} skipped in use).`,
  };
}

/**
 * Executes a file overwrite / shredding plan or free-space wipe plan through the framework pipeline:
 * 1. Writes a backup manifest to the shared backup store before the first destructive call.
 * 2. For each action:
 *    - For free-space wipe: writes random bytes up to maxWipeBytes leaving headroom floor, fsyncs, deletes temp file in finally, verifies deletion.
 *    - For file shred: opens read-write, overwrites passes × length with crypto.randomBytes, fsyncs before closing, deletes file only after all passes complete, verifies by read-back.
 *    - Per-file accounting: nonexistent paths and locked/failed paths are NOT counted as completed or shredded.
 * 3. Records actual bytesWritten (never estimated/hardcoded).
 * 4. Logs confirmed outcome to activity log.
 * 5. Returns partial-failure aware ExecuteResult.
 */
export async function executeOverwriteFiles(
  plan: import('./types').OperationPlan,
  logActivity?: (item: any) => void,
  runners?: ExecutionRunners
): Promise<ExecuteResult> {
  // 1. Write backup manifest before first destructive call (Phase 3 rail)
  const backupDir = runners?.backupDirOverride ?? getModuleBackupDir(plan.module);
  const isoTimestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const manifestPath = path.join(backupDir, `${isoTimestamp}-manifest.json`);

  try {
    writeFileBackupManifest(manifestPath, {
      planId: plan.id,
      module: plan.module,
      timestamp: new Date().toISOString(),
      reversibility: plan.reversibility,
      irreversibilityReason: plan.irreversibilityReason,
      totalReclaimableBytes: plan.totalReclaimableBytes,
      actions: plan.actions.map((a) => ({
        id: a.id,
        kind: a.kind,
        target: a.target,
        description: a.description,
        reclaimableBytes: a.reclaimableBytes,
        metadata: a.metadata,
      })),
    });
  } catch (err) {
    return {
      success: false,
      completed: 0,
      failed: plan.actions.length,
      skipped: 0,
      reclaimableBytes: null,
      bytesWritten: 0,
      failures: [
        {
          target: manifestPath,
          error: `Backup manifest creation failed: ${err instanceof Error ? err.message : String(err)}`,
        },
      ],
      message: 'Backup manifest failed before execution; no changes were made.',
    };
  }

  let completed = 0;
  let failed = 0;
  const skipped = 0;
  let freedBytes = 0;
  let totalBytesWritten = 0;
  let hasPartialWipe = false;
  const failures: ExecuteFailure[] = [];

  const unlinkFn = runners?.unlinkFn ?? (async (p: string) => fs.promises.unlink(p));
  const randomBytesFn = runners?.randomBytesFn ?? crypto.randomBytes;

  for (const action of plan.actions) {
    if (action.kind !== 'overwrite-file') {
      failures.push({
        target: action.target,
        error: `Unexpected action kind for overwrite executor: ${action.kind}`,
      });
      failed++;
      continue;
    }

    // Free space wipe branch
    if (action.metadata?.isFreeSpaceWipe) {
      const tempPath = action.target;
      const maxWipeBytes = typeof action.metadata.maxWipeBytes === 'number' ? action.metadata.maxWipeBytes : 0;
      let wipedBytes = 0;
      let wipeError: Error | null = null;
      const CHUNK_SIZE = 65536;

      try {
        // Clean up any stale temp file first
        if (fs.existsSync(tempPath)) {
          try {
            await unlinkFn(tempPath);
          } catch {}
        }

        const handle = await fs.promises.open(tempPath, 'w');
        try {
          if (maxWipeBytes > 0) {
            const chunkBuf = randomBytesFn(CHUNK_SIZE);
            while (wipedBytes < maxWipeBytes) {
              const toWrite = Math.min(CHUNK_SIZE, maxWipeBytes - wipedBytes);
              const bufToWrite = toWrite === CHUNK_SIZE ? chunkBuf : chunkBuf.subarray(0, toWrite);
              const { bytesWritten: written } = await handle.write(bufToWrite, 0, toWrite, wipedBytes);
              wipedBytes += written;
              if (written === 0) break;
            }
          }
          await handle.sync();
        } finally {
          await handle.close();
        }
      } catch (err: unknown) {
        wipeError = err instanceof Error ? err : new Error(String(err));
      } finally {
        // Deterministic temp file: always deleted in finally
        if (fs.existsSync(tempPath)) {
          try {
            await unlinkFn(tempPath);
          } catch (e) {
            console.warn('Failed to unlink wipe temp file in finally:', e);
          }
        }
      }

      // Verification by read-back: confirm temp file is gone
      if (fs.existsSync(tempPath)) {
        failures.push({
          target: tempPath,
          error: 'Verification failed: wipe temp file still exists after completion',
        });
        failed++;
      } else if (wipeError) {
        failures.push({
          target: tempPath,
          error: `Free space wipe failed: ${wipeError.message}`,
        });
        failed++;
      } else {
        completed++;
        totalBytesWritten += wipedBytes;
        // Headroom floor: stop writing at max(1 GB, 5% of volume). Report as partial.
        hasPartialWipe = true;
      }
      continue;
    }

    // Standard file shred branch
    // Per-file accounting: nonexistent file CANNOT be shredded and must NOT count as completed
    if (!fs.existsSync(action.target)) {
      failures.push({
        target: action.target,
        error: 'Target does not exist on disk: cannot overwrite',
      });
      failed++;
      continue;
    }

    let stat: fs.Stats;
    try {
      stat = await fs.promises.stat(action.target);
      if (stat.isDirectory()) {
        failures.push({
          target: action.target,
          error: 'Target is a directory: overwrite-file applies only to files',
        });
        failed++;
        continue;
      }
    } catch (err: unknown) {
      failures.push({
        target: action.target,
        error: `Cannot stat target: ${err instanceof Error ? err.message : String(err)}`,
      });
      failed++;
      continue;
    }

    const fileSize = stat.size;
    const passes = typeof action.metadata?.passes === 'number' ? action.metadata.passes : 1;
    if (!Number.isInteger(passes) || passes < 1 || passes > 3) {
      failures.push({
        target: action.target,
        error: `Invalid pass count: ${passes}. Must be an integer between 1 and 3.`,
      });
      failed++;
      continue;
    }

    let fileHandle: fs.promises.FileHandle;
    try {
      fileHandle = await fs.promises.open(action.target, 'r+');
    } catch (err: unknown) {
      failures.push({
        target: action.target,
        error: `Failed to open file for read-write: ${err instanceof Error ? err.message : String(err)}`,
      });
      failed++;
      continue;
    }

    let fileBytesWritten = 0;
    const CHUNK_SIZE = 65536;
    let writeError: Error | null = null;

    try {
      for (let pass = 0; pass < passes; pass++) {
        if (fileSize > 0) {
          const chunkBuf = randomBytesFn(Math.min(fileSize, CHUNK_SIZE));
          let passWritten = 0;
          while (passWritten < fileSize) {
            const toWrite = Math.min(chunkBuf.length, fileSize - passWritten);
            const { bytesWritten: writtenChunk } = await fileHandle.write(
              chunkBuf,
              0,
              toWrite,
              passWritten
            );
            passWritten += writtenChunk;
            fileBytesWritten += writtenChunk;
          }
        }
      }
      // fsync before closing (Step 1 requirement)
      await fileHandle.sync();
    } catch (err: unknown) {
      writeError = err instanceof Error ? err : new Error(String(err));
    } finally {
      await fileHandle.close();
    }

    if (writeError) {
      failures.push({
        target: action.target,
        error: `Overwrite write failed: ${writeError.message}`,
      });
      failed++;
      continue;
    }

    // Delete the file only after every pass completed
    try {
      await unlinkFn(action.target);
    } catch (err: unknown) {
      failures.push({
        target: action.target,
        error: `Failed to delete file after overwrite passes: ${err instanceof Error ? err.message : String(err)}`,
      });
      failed++;
      continue;
    }

    // Verification by read-back: confirm file is gone
    if (fs.existsSync(action.target)) {
      failures.push({
        target: action.target,
        error: 'Verification failed: target still exists on disk after shredding',
      });
      failed++;
    } else {
      completed++;
      totalBytesWritten += fileBytesWritten;
      if (typeof action.reclaimableBytes === 'number') {
        freedBytes += action.reclaimableBytes;
      }
    }
  }

  // A wipe that stops early is a partial result, reported as partial — not a failure, and not a success.
  const success = !hasPartialWipe && completed === plan.actions.length && failed === 0;

  if (logActivity) {
    const isAllSuccess = success;
    logActivity({
      module: plan.module,
      title: isAllSuccess ? 'Secure Erase Completed' : 'Secure Erase Completed (Partial)',
      detail: hasPartialWipe
        ? `Free space wipe completed: ${totalBytesWritten} bytes written (partial result leaving headroom).`
        : `Shredded ${completed} of ${plan.actions.length} items (${totalBytesWritten} bytes written). ${failed} failed. Backup manifest: ${path.basename(manifestPath)}`,
      type: isAllSuccess ? 'success' : 'warning',
      spaceFreedBytes: freedBytes,
    });
  }

  removeOperationPlan(plan.id);

  const message = success
    ? `Successfully shredded ${completed} item${completed === 1 ? '' : 's'}`
    : hasPartialWipe
    ? `Free space wipe completed ${totalBytesWritten} bytes, stopped at headroom floor (partial result)`
    : `Shredding incomplete: ${completed} completed, ${failed} failed`;

  return {
    success,
    completed,
    failed,
    skipped,
    reclaimableBytes: freedBytes,
    bytesWritten: totalBytesWritten,
    failures,
    backupPath: manifestPath,
    message,
  };
}


/**
 * Handles atomic registry restore through the framework.
 */
async function executeRegistryRestore(
  plan: import('./types').OperationPlan,
  action: PlannedAction,
  logActivity?: (item: any) => void
): Promise<ExecuteResult> {
  const backupFilePath = action.metadata?.backupFilePath as string;
  const hive = (action.metadata?.hive as 'HKCU' | 'HKLM') || 'HKCU';
  const itemName = (action.metadata?.itemName as string) || path.basename(backupFilePath);
  const keyPath = (action.metadata?.keyPath as string) || '';
  const valueName = (action.metadata?.valueName as string) || '';
  const approvedKeyPath = (action.metadata?.approvedKeyPath as string) || '';
  const approvedValueName = (action.metadata?.approvedValueName as string) || '';

  // 2. Safety backup before destructive call (Phase 3 rail)
  let safetyBackupPath = '';
  try {
    const backupDir = getModuleBackupDir(plan.module);
    const isoTimestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const sanitizedName = itemName.replace(/[^a-zA-Z0-9._-]+/g, '_');
    safetyBackupPath = path.join(backupDir, `safety-${isoTimestamp}-${hive}-${sanitizedName}.reg`);

    const safetySnippets: string[] = [];

    if (keyPath && valueName) {
      const currentRun = await readValue(hive, keyPath, valueName);
      if (currentRun.exists && currentRun.data !== undefined) {
        safetySnippets.push(
          buildRegSnippet(
            hive,
            keyPath,
            valueName,
            currentRun.data as any,
            currentRun.type || 'REG_SZ'
          )
        );
      }
    }

    if (approvedKeyPath && approvedValueName) {
      const currentApproved = await readValue(hive, approvedKeyPath, approvedValueName);
      if (currentApproved.exists && currentApproved.data !== undefined) {
        safetySnippets.push(
          buildRegSnippet(
            hive,
            approvedKeyPath,
            approvedValueName,
            currentApproved.data as any,
            'REG_BINARY'
          )
        );
      }
    }

    if (safetySnippets.length > 0) {
      writeRegBackupFile(safetyBackupPath, safetySnippets, {
        module: plan.module,
        itemName,
        hive,
        location: action.metadata?.location as string,
        valueName,
        timestamp: new Date().toISOString(),
      });
    }
  } catch (err) {
    return {
      success: false,
      completed: 0,
      failed: 1,
      skipped: 0,
      reclaimableBytes: null,
      failures: [
        {
          target: backupFilePath,
          error: `Safety backup failed before restore: ${err instanceof Error ? err.message : String(err)}`,
        },
      ],
      message: 'Safety backup failed before restore; no changes were made.',
    };
  }

  // 3. Atomic execute: run reg import
  try {
    const escapedPath = backupFilePath.replace(/'/g, "''");
    const importScript = `$p = '${escapedPath}'; & reg.exe import $p`;
    await runPowerShell(importScript);
  } catch (err) {
    return {
      success: false,
      completed: 0,
      failed: 1,
      skipped: 0,
      reclaimableBytes: null,
      failures: [
        {
          target: backupFilePath,
          error: `reg import failed: ${err instanceof Error ? err.message : String(err)}`,
        },
      ],
      message: 'Registry import failed.',
    };
  }

  // 4. Verify by read-back: confirm state in registry matches backup
  try {
    const fileContent = readBackupFileText(backupFilePath);

    // If backup contained StartupApproved flag, verify the flag
    if (approvedKeyPath && approvedValueName) {
      const expectedDisabled = /hex:03,/i.test(fileContent);
      const expectedEnabled = /hex:02,/i.test(fileContent);
      const expectedDelete = /"=-/i.test(fileContent);

      const verification = await readValue(hive, approvedKeyPath, approvedValueName);

      if (expectedDelete) {
        if (verification.exists) {
          return {
            success: false,
            completed: 0,
            failed: 1,
            skipped: 0,
            reclaimableBytes: null,
            failures: [
              {
                target: `${approvedKeyPath}\\${approvedValueName}`,
                error: 'Verification failed: flag value was expected to be deleted but still exists',
              },
            ],
            message: 'Restore could not be verified.',
          };
        }
      } else if (expectedDisabled || expectedEnabled) {
        if (!verification.exists) {
          return {
            success: false,
            completed: 0,
            failed: 1,
            skipped: 0,
            reclaimableBytes: null,
            failures: [
              {
                target: `${approvedKeyPath}\\${approvedValueName}`,
                error: 'Verification failed: StartupApproved flag was not found after restore',
              },
            ],
            message: 'Restore could not be verified.',
          };
        }
        const isEnabled = decodeStartupApproved(verification.data);
        if (expectedDisabled && isEnabled) {
          return {
            success: false,
            completed: 0,
            failed: 1,
            skipped: 0,
            reclaimableBytes: null,
            failures: [
              {
                target: `${approvedKeyPath}\\${approvedValueName}`,
                error: 'Verification failed: item was expected to be disabled but reads enabled',
              },
            ],
            message: 'Restore could not be verified.',
          };
        }
        if (expectedEnabled && !isEnabled) {
          return {
            success: false,
            completed: 0,
            failed: 1,
            skipped: 0,
            reclaimableBytes: null,
            failures: [
              {
                target: `${approvedKeyPath}\\${approvedValueName}`,
                error: 'Verification failed: item was expected to be enabled but reads disabled',
              },
            ],
            message: 'Restore could not be verified.',
          };
        }
      }
    }

    // If backup contained a Run value, verify Run value exists
    if (keyPath && valueName) {
      const runCheck = await readValue(hive, keyPath, valueName);
      if (!runCheck.exists) {
        return {
          success: false,
          completed: 0,
          failed: 1,
          skipped: 0,
          reclaimableBytes: null,
          failures: [
            {
              target: `${keyPath}\\${valueName}`,
              error: 'Verification failed: Run registry value was not found after restore',
            },
          ],
          message: 'Restore could not be verified.',
        };
      }
    }
  } catch (err) {
    return {
      success: false,
      completed: 0,
      failed: 1,
      skipped: 0,
      reclaimableBytes: null,
      failures: [
        {
          target: backupFilePath,
          error: `Verification error: ${err instanceof Error ? err.message : String(err)}`,
        },
      ],
      message: 'Verification check failed after restore.',
    };
  }

  // 5. Record: log confirmed outcome to activity log
  if (logActivity) {
    logActivity({
      module: plan.module,
      title: 'Startup Item Restored',
      detail: `Restored "${itemName}" from backup ${path.basename(backupFilePath)}.${
        safetyBackupPath ? ` Safety backup: ${path.basename(safetyBackupPath)}.` : ''
      }`,
      type: 'success',
    });
  }

  removeOperationPlan(plan.id);

  return {
    success: true,
    completed: plan.actions.length,
    failed: 0,
    skipped: 0,
    reclaimableBytes: null,
    failures: [],
    backupPath: safetyBackupPath || undefined,
    message: `Successfully restored ${itemName} from backup.`,
  };
}

async function defaultDeleteKey(hive: RegistryHive, keyPath: string): Promise<void> {
  const cleanPath = keyPath
    .replace(/^(HKCU:|HKLM:|HKEY_CURRENT_USER|HKEY_LOCAL_MACHINE)[\\\/]*/i, '')
    .replace(/^[\\\/]+/, '');
  const psPath = `${hive}:\\${cleanPath}`;
  const escaped = psPath.replace(/'/g, "''");
  await runPowerShell(`Remove-Item -LiteralPath '${escaped}' -Recurse -Force -ErrorAction Stop`);
}

async function defaultDeleteValue(hive: RegistryHive, keyPath: string, valueName: string): Promise<void> {
  const cleanPath = keyPath
    .replace(/^(HKCU:|HKLM:|HKEY_CURRENT_USER|HKEY_LOCAL_MACHINE)[\\\/]*/i, '')
    .replace(/^[\\\/]+/, '');
  const psPath = `${hive}:\\${cleanPath}`;
  const escapedPath = psPath.replace(/'/g, "''");
  const escapedName = valueName.replace(/'/g, "''");
  await runPowerShell(
    `Remove-ItemProperty -LiteralPath '${escapedPath}' -Name '${escapedName}' -Force -ErrorAction Stop`
  );
}

/**
 * Executes a RegistryFixer deletion plan through the framework pipeline:
 * 1. Checks initial existence of every target to distinguish already-absent entries.
 * 2. If all entries are already absent: reports no-op honestly without modifying anything.
 * 3. BACKS UP BEFORE THE FIRST DESTRUCTIVE CALL to %APPDATA%\DeskKlean\backups\registry\<ISO>-<slug>.reg.
 * 4. VALIDATES THE BACKUP BEFORE DELETING: re-reads and asserts BOM, header, CRLF, and parseable section headers.
 *    If validation fails: ABORTS immediately with zero deletions.
 * 5. Executes deletions and VERIFIES EACH by read-back: confirm subkey or value no longer exists.
 *    A delete that silently did nothing is recorded as verification failure.
 * 6. Records confirmed outcome in activity log.
 * 7. Returns partial-failure aware ExecuteResult.
 */
export async function executeRegistryDeletions(
  plan: import('./types').OperationPlan,
  logActivity?: (item: any) => void,
  runners: RegistryExecutionRunners = {}
): Promise<ExecuteResult> {
  const keyExistsCheck = runners.keyExistsFn ?? keyExists;
  const readValueCheck = runners.readValueFn ?? readValue;
  const readSubKeys = runners.readSubKeyValuesWithTypesFn ?? readSubKeyValuesWithTypes;
  const deleteKeyAction = runners.deleteKeyFn ?? defaultDeleteKey;
  const deleteValueAction = runners.deleteValueFn ?? defaultDeleteValue;
  const writeBackup = runners.writeBackupFn ?? writeRegistryFixerBackupFile;
  const validateBackup = runners.validateBackupFn ?? validateRegBackupFile;

  // 1. Discover which entries exist before touching anything
  const backupEntries: RegistryBackupEntry[] = [];
  const initialExistence = new Map<string, boolean>();

  for (const action of plan.actions) {
    const hive = (action.metadata?.hive as RegistryHive) || 'HKCU';
    const keyPath = (action.metadata?.keyPath as string) || '';
    const valueName = action.metadata?.valueName as string | undefined;

    if (action.kind === 'registry-key') {
      const exists = await keyExistsCheck(hive, keyPath);
      initialExistence.set(action.id, exists);
      if (exists) {
        const values = await readSubKeys(hive, keyPath);
        backupEntries.push({
          type: 'orphaned_uninstall',
          hive,
          keyPath,
          values,
        });
      }
    } else if (action.kind === 'registry-value') {
      const valName = valueName || '';
      const check = await readValueCheck(hive, keyPath, valName);
      initialExistence.set(action.id, check.exists);
      if (check.exists) {
        backupEntries.push({
          type: 'stale_mui_cache',
          hive,
          keyPath,
          valueName: valName,
          valueType: check.type || 'REG_SZ',
          data: check.data,
        });
      }
    }
  }

  // Rail: AN ENTRY ALREADY REMOVED BY ANOTHER PROCESS IS A NO-OP, not a success and not a failure.
  const allAlreadyAbsent = plan.actions.every((a) => initialExistence.get(a.id) === false);
  if (allAlreadyAbsent) {
    removeOperationPlan(plan.id);
    const msg =
      plan.actions.length === 1
        ? 'Entry was already absent from the registry.'
        : 'All selected entries were already absent from the registry.';

    if (logActivity) {
      logActivity({
        module: plan.module,
        title: 'Registry Fix Skipped (Already Absent)',
        detail: `${msg} No changes were made.`,
        type: 'info',
      });
    }

    return {
      success: false,
      completed: 0,
      failed: 0,
      skipped: plan.actions.length,
      reclaimableBytes: null,
      failures: [],
      message: msg,
    };
  }

  // 2. Create Backup BEFORE the first destructive call
  const backupDir = runners.backupDirOverride ?? getModuleBackupDir('registry');
  const isoTimestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const slug =
    plan.actions.length === 1
      ? slugify((plan.actions[0].metadata?.displayName as string) || 'entry')
      : `registry-fix-${plan.actions.length}-items`;
  const backupPath = path.join(backupDir, `${isoTimestamp}-${slug}.reg`);

  try {
    const backupContent = formatRegistryFixerBackup(backupEntries);
    writeBackup(backupPath, backupContent);
  } catch (err) {
    return {
      success: false,
      completed: 0,
      failed: plan.actions.length,
      skipped: 0,
      reclaimableBytes: null,
      failures: [
        {
          target: backupPath,
          error: `Backup creation failed before execution: ${err instanceof Error ? err.message : String(err)}`,
        },
      ],
      message: 'Backup creation failed before execution; no registry changes were made.',
    };
  }

  // 3. VALIDATE THE BACKUP BEFORE DELETING. If validation fails, ABORT — do not delete.
  const validation = validateBackup(backupPath);
  if (!validation.valid) {
    return {
      success: false,
      completed: 0,
      failed: plan.actions.length,
      skipped: 0,
      reclaimableBytes: null,
      failures: [
        {
          target: backupPath,
          error: `Backup validation failed: ${validation.reason}`,
        },
      ],
      message: `Backup validation failed: ${validation.reason}. Operation aborted; no registry changes were made.`,
    };
  }

  // 4. Execute deletions and verify each
  let completed = 0;
  let failed = 0;
  let skipped = 0;
  const failures: ExecuteFailure[] = [];

  for (const action of plan.actions) {
    const wasPresent = initialExistence.get(action.id);
    if (!wasPresent) {
      skipped++;
      continue;
    }

    const hive = (action.metadata?.hive as RegistryHive) || 'HKCU';
    const keyPath = (action.metadata?.keyPath as string) || '';
    const valueName = (action.metadata?.valueName as string) || '';

    try {
      if (action.kind === 'registry-key') {
        await deleteKeyAction(hive, keyPath);
      } else if (action.kind === 'registry-value') {
        await deleteValueAction(hive, keyPath, valueName);
      }
    } catch (err) {
      failures.push({
        target: action.target,
        error: `Deletion error: ${err instanceof Error ? err.message : String(err)}`,
      });
      failed++;
      continue;
    }

    // Rail: A DELETE THAT SILENTLY DID NOTHING MUST NEVER REPORT SUCCESS.
    // Verify by re-reading the registry: confirm subkey or value no longer exists.
    try {
      if (action.kind === 'registry-key') {
        const stillExists = await keyExistsCheck(hive, keyPath);
        if (stillExists) {
          failures.push({
            target: action.target,
            error: 'Verification failed: registry key still exists after deletion',
          });
          failed++;
        } else {
          completed++;
        }
      } else if (action.kind === 'registry-value') {
        const check = await readValueCheck(hive, keyPath, valueName);
        if (check.exists) {
          failures.push({
            target: action.target,
            error: 'Verification failed: registry value still exists after deletion',
          });
          failed++;
        } else {
          completed++;
        }
      }
    } catch (err) {
      failures.push({
        target: action.target,
        error: `Verification error: ${err instanceof Error ? err.message : String(err)}`,
      });
      failed++;
    }
  }

  removeOperationPlan(plan.id);

  // 5. Record confirmed outcomes only
  const success = completed === plan.actions.length && failed === 0;

  if (logActivity) {
    if (success) {
      logActivity({
        module: plan.module,
        title: 'Registry Cleaned',
        detail: `Removed ${completed} dead registry ${completed === 1 ? 'entry' : 'entries'}. Backup: ${path.basename(backupPath)}`,
        type: 'success',
      });
    } else if (completed > 0 || failed > 0) {
      logActivity({
        module: plan.module,
        title: 'Registry Cleaned (Partial)',
        detail: `Removed ${completed} of ${plan.actions.length} entries (${failed} failed, ${skipped} already absent). Backup: ${path.basename(backupPath)}`,
        type: failed > 0 ? 'warning' : 'info',
      });
    }
  }

  let message: string;
  if (success) {
    message = `Successfully removed ${completed} dead registry ${completed === 1 ? 'entry' : 'entries'}.`;
  } else if (completed > 0) {
    message = `Removed ${completed} of ${plan.actions.length} entries (${failed} failed, ${skipped} already absent).`;
  } else if (failed > 0) {
    message = `Failed to remove ${failed} entries (${skipped} already absent).`;
  } else {
    message = 'No entries were modified.';
  }

  return {
    success,
    completed,
    failed,
    skipped,
    reclaimableBytes: null,
    failures,
    backupPath,
    message,
  };
}

/**
 * Executes an application uninstallation plan through the framework pipeline:
 * 1. Writes backup manifest to shared backup store before the first destructive call; aborts if backup fails.
 * 2. Pre-flight check: verifies uninstaller executable exists on disk (D-AR-7).
 * 3. Launches uninstaller process and waits for the entire process tree to exit (OQ-AR-4).
 * 4. Re-enumerates installed applications to verify removal (D-AR-4).
 * 5. Checks for pending reboot operations if still present (D-AR-6).
 * 6. Logs confirmed outcome to activity log.
 */
export async function executeUninstallActions(
  plan: import('./types').OperationPlan,
  logActivity?: (item: any) => void,
  runners?: UninstallExecutionRunners
): Promise<ExecuteResult> {
  const backupDir = runners?.backupDirOverride ?? getModuleBackupDir(plan.module);
  const isoTimestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const manifestPath = path.join(backupDir, `${isoTimestamp}-uninstall-manifest.json`);

  // 1. Safety backup manifest before first destructive call (Phase 3 rail)
  try {
    writeFileBackupManifest(manifestPath, {
      planId: plan.id,
      module: plan.module,
      timestamp: new Date().toISOString(),
      reversibility: plan.reversibility,
      irreversibilityReason: plan.irreversibilityReason,
      totalReclaimableBytes: plan.totalReclaimableBytes,
      actions: plan.actions.map((a) => ({
        id: a.id,
        kind: a.kind,
        target: a.target,
        description: a.description,
        reclaimableBytes: a.reclaimableBytes,
        metadata: a.metadata,
      })),
    });
  } catch (err) {
    return {
      success: false,
      completed: 0,
      failed: plan.actions.length,
      skipped: 0,
      reclaimableBytes: null,
      failures: [
        {
          target: manifestPath,
          error: `Backup manifest creation failed before uninstall: ${
            err instanceof Error ? err.message : String(err)
          }`,
        },
      ],
      message: 'Backup manifest failed before uninstallation; no changes were made.',
    };
  }

  let completed = 0;
  let failed = 0;
  let skipped = 0;
  let freedBytes = 0;
  let rebootRequired = false;
  const failures: ExecuteFailure[] = [];

  for (const action of plan.actions) {
    if (action.kind !== 'uninstall') {
      failures.push({
        target: action.target,
        error: `Unexpected action kind "${action.kind}" in uninstall plan`,
      });
      failed++;
      continue;
    }

    const appId = (action.metadata?.appId as string) || action.target;
    const isStoreApp = Boolean(action.metadata?.isStoreApp);
    const isMsi = Boolean(action.metadata?.isMsi);
    const productCode = action.metadata?.productCode as string | undefined;
    const executable = (action.metadata?.executable as string) || action.target;
    const args = (action.metadata?.args as string[]) || [];
    const isInteractive = Boolean(action.metadata?.isInteractive);

    // Pre-flight check: missing UninstallString target files caught before launch (D-AR-7)
    const baseExe = (
      path.win32 ? path.win32.basename(executable) : executable.replace(/^.*[\\/]/, '')
    ).toLowerCase();
    const isDirectSystemExe = ['msiexec', 'msiexec.exe', 'cmd.exe', 'powershell.exe'].includes(baseExe);
    const checkFile = runners?.fileExistsFn ?? fs.existsSync;
    if (!isStoreApp && !isMsi && !isDirectSystemExe && !checkFile(executable)) {
      failures.push({
        target: action.target,
        error: `Uninstall unavailable — installer not found: ${executable}`,
      });
      failed++;
      continue;
    }

    // Launch & wait
    try {
      if (isStoreApp) {
        // Store app removal via PowerShell
        const psCmd = `Remove-AppxPackage -Package "${appId}"`;
        if (runners?.runPowerShellFn) {
          await runners.runPowerShellFn(psCmd);
        } else {
          await runPowerShell(psCmd);
        }
      } else {
        // Desktop / MSI app removal
        let rootPid = 0;
        if (runners?.spawnProcessFn) {
          const spawned = await runners.spawnProcessFn(executable, args, isInteractive);
          rootPid = spawned.pid;
        } else {
          const { spawn } = await import('child_process');
          const child = spawn(executable, args, {
            windowsHide: !isInteractive,
            detached: false,
            stdio: isInteractive ? 'inherit' : 'ignore',
          });
          rootPid = child.pid || 0;
        }

        // Wait for process tree (OQ-AR-4)
        if (runners?.waitForProcessTreeFn) {
          await runners.waitForProcessTreeFn(rootPid, {
            timeoutMs: isInteractive ? 300000 : 60000,
          });
        } else if (rootPid > 0) {
          await waitForProcessTree(rootPid, {
            timeoutMs: isInteractive ? 300000 : 60000,
          });
        }
      }
    } catch (err) {
      failures.push({
        target: action.target,
        error: `Uninstaller launch error: ${err instanceof Error ? err.message : String(err)}`,
      });
      failed++;
      continue;
    }

    // BINDING RAIL 1 & D-AR-4: Verification is by re-enumeration, NEVER exit code alone!
    try {
      const reEnumerated = runners?.reEnumerateFn
        ? await runners.reEnumerateFn()
        : await getAllInstalledApps();

      const verification = verifyAppRemoved(appId, reEnumerated, productCode);

      if (verification.removed) {
        // Verified gone from system!
        completed++;
        if (typeof action.reclaimableBytes === 'number') {
          freedBytes += action.reclaimableBytes;
        }
      } else {
        // Product still registered: check reboot-pending (D-AR-6)
        const pendingReboot = runners?.checkPendingRebootFn
          ? await runners.checkPendingRebootFn()
          : await checkPendingReboot();

        if (pendingReboot) {
          rebootRequired = true;
          failures.push({
            target: action.target,
            error: 'Uninstall will complete after a reboot.',
          });
          failed++;
        } else {
          failures.push({
            target: action.target,
            error: 'Verification failed: uninstaller exited but the product is still registered.',
          });
          failed++;
        }
      }
    } catch (err) {
      failures.push({
        target: action.target,
        error: `Verification error during re-enumeration: ${
          err instanceof Error ? err.message : String(err)
        }`,
      });
      failed++;
    }
  }

  removeOperationPlan(plan.id);

  const success = completed === plan.actions.length && failed === 0;

  if (logActivity) {
    if (success) {
      logActivity({
        module: plan.module,
        title: 'Application Uninstalled',
        detail: `Successfully uninstalled ${completed} application(s). Confirmed by re-enumeration. Backup manifest: ${path.basename(
          manifestPath
        )}`,
        type: 'success',
        spaceFreedBytes: freedBytes || undefined,
      });
    } else if (rebootRequired) {
      logActivity({
        module: plan.module,
        title: 'Uninstall Requires Reboot',
        detail: 'Uninstallation has scheduled file removals and will complete after system reboot.',
        type: 'warning',
      });
    } else {
      logActivity({
        module: plan.module,
        title: 'Application Uninstall Failed',
        detail: failures.map((f) => f.error).join('; '),
        type: 'error',
      });
    }
  }

  let message: string;
  if (success) {
    message = `Successfully uninstalled and verified removal of ${completed} application(s).`;
  } else if (rebootRequired) {
    message = 'Uninstall will complete after a reboot.';
  } else if (completed > 0) {
    message = `Uninstalled ${completed} application(s), but ${failed} failed verification.`;
  } else {
    message = failures[0]?.error || 'Application uninstall failed verification.';
  }

  return {
    success,
    completed,
    failed,
    skipped,
    reclaimableBytes: freedBytes > 0 ? freedBytes : null,
    failures,
    backupPath: manifestPath,
    message,
  };
}
