import fs from 'fs';
import path from 'path';
import { runPowerShell, isWindows } from '../powershell';
import { readValue, buildRegSnippet, decodeStartupApproved } from '../registry';
import { isElevated } from '../elevation';
import { getOperationPlan, removeOperationPlan } from './plan';
import {
  writeRegBackupFile,
  readBackupFileText,
  parseRegMetadata,
  getModuleBackupDir,
} from './backup';
import { ExecuteResult, PlannedAction } from './types';

/**
 * Executes a planned destructive operation (such as restoring a registry backup).
 *
 * Enforces Phase 3 contract rails:
 * 1. Checks elevation before touching anything.
 * 2. Backs up current state before the first destructive call; aborts if backup fails.
 * 3. Atomic execution: runs the restore.
 * 4. Verification: re-reads the registry to confirm intended state.
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
  }) => void
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
    const elevated = await isElevated();
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

  if (!isWindows()) {
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
