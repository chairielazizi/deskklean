import {
  RegistryFixerIssue,
  RegistryFixerResult,
  OperationPlan,
  PlannedAction,
  BlockedAction,
  Reversibility,
} from '../../../shared/types';
import { createOperationPlan } from '../framework/plan';
import { executeOperationPlan, RegistryExecutionRunners } from '../framework/execute';
import { validateRegistryPath } from '../framework/protected';
import { isElevated } from '../elevation';

export interface RegistryFixPlanOptions {
  customExcludedPaths?: string[];
  isElevatedFn?: () => Promise<boolean>;
}

export interface RegistryFixOptions extends RegistryFixPlanOptions {
  logActivity?: (item: {
    module: string;
    title: string;
    detail: string;
    type: 'info' | 'success' | 'warning' | 'error';
    spaceFreedBytes?: number;
  }) => void;
  runners?: RegistryExecutionRunners;
}

/**
 * Validates a registry fix target before it is allowed into an OperationPlan.
 * Refuses critical system keys, root uninstall containers, and invalid paths.
 */
export function validateRegistryFixTarget(
  hive: string,
  keyPath: string,
  type: string
): { allowed: boolean; reason?: string } {
  if (!keyPath || !keyPath.trim()) {
    return { allowed: false, reason: 'Target registry key path cannot be empty' };
  }
  if (keyPath.includes('\0')) {
    return { allowed: false, reason: 'Target registry path contains illegal null bytes' };
  }

  // Centrally check framework protected registry paths
  const protCheck = validateRegistryPath(hive, keyPath);
  if (!protCheck.allowed) {
    return protCheck;
  }

  // Guard against deleting the root Uninstall keys themselves
  const normKey = keyPath.replace(/\\/g, '/').toLowerCase().replace(/^\/+|\/+$/g, '');
  const rootUninstallPaths = [
    'software/microsoft/windows/currentversion/uninstall',
    'software/wow6432node/microsoft/windows/currentversion/uninstall',
  ];

  if (type === 'orphaned_uninstall') {
    if (rootUninstallPaths.includes(normKey)) {
      return {
        allowed: false,
        reason: `Refused target: cannot delete the root Uninstall registry key (${keyPath})`,
      };
    }
  }

  return { allowed: true };
}

/**
 * Converts selected RegistryFixerIssues into a framework OperationPlan.
 *
 * Rails:
 * - orphaned_uninstall: delete the entire registry subkey ('registry-key').
 * - stale_mui_cache: delete the specific registry value ('registry-value').
 * - reversibility: 'reversible' (the .reg backup makes it undoable via reg import).
 * - reclaimableBytes: null — registry keys have no meaningful byte size. NEVER estimate.
 * - requiresElevation: true when any target is under HKLM.
 * - Validate every target against the framework's protected list before it enters the plan.
 * - PLANNING MUST NOT MUTATE ANYTHING — not even creating the backup directory.
 */
export function createRegistryFixPlan(
  issues: RegistryFixerIssue[],
  selectedIssueIds?: string[],
  options: RegistryFixPlanOptions = {}
): OperationPlan {
  // 1. Filter selected issues
  let selectedIssues: RegistryFixerIssue[];
  if (selectedIssueIds && selectedIssueIds.length > 0) {
    selectedIssues = issues.filter((i) => selectedIssueIds.includes(i.id));
  } else {
    selectedIssues = issues.filter((i) => i.selected);
  }

  // 2. Determine elevation requirement: true if any selected issue is under HKLM
  const requiresElevation = selectedIssues.some((i) => i.hive === 'HKLM');

  // 3. Reversibility is always 'reversible' due to .reg backup
  const reversibility: Reversibility = 'reversible';

  // 4. Validate targets against protected list and build PlannedAction / BlockedAction items
  const actions: PlannedAction[] = [];
  const blocked: BlockedAction[] = [];

  for (const issue of selectedIssues) {
    const targetValidation = validateRegistryFixTarget(issue.hive, issue.keyPath, issue.type);

    if (!targetValidation.allowed) {
      blocked.push({
        target: `${issue.hive}\\${issue.keyPath}${issue.valueName ? `\\${issue.valueName}` : ''}`,
        reason: targetValidation.reason || 'Target is protected by system integrity policy',
      });
      continue;
    }

    if (issue.type === 'orphaned_uninstall') {
      actions.push({
        id: issue.id,
        kind: 'registry-key',
        target: `${issue.hive}\\${issue.keyPath}`,
        description: `Delete orphaned uninstall subkey: ${issue.hive}\\${issue.keyPath} (${issue.displayName})`,
        reclaimableBytes: null, // Registry keys have no meaningful byte size; never estimated
        metadata: {
          issueId: issue.id,
          type: issue.type,
          hive: issue.hive,
          keyPath: issue.keyPath,
          displayName: issue.displayName,
          checkedPath: issue.evidence.checkedPath,
        },
      });
    } else if (issue.type === 'stale_mui_cache') {
      const valName = issue.valueName || '';
      actions.push({
        id: issue.id,
        kind: 'registry-value',
        target: `${issue.hive}\\${issue.keyPath}\\${valName}`,
        description: `Delete stale MUICache value: "${valName}" (${issue.displayName})`,
        reclaimableBytes: null, // Registry values have no meaningful byte size; never estimated
        metadata: {
          issueId: issue.id,
          type: issue.type,
          hive: issue.hive,
          keyPath: issue.keyPath,
          valueName: valName,
          displayName: issue.displayName,
          checkedPath: issue.evidence.checkedPath,
        },
      });
    }
  }

  // 5. Construct and register OperationPlan with Phase 3 framework
  return createOperationPlan({
    module: 'registry-fixer',
    actions,
    blocked,
    reversibility,
    requiresElevation,
  });
}

export const planRegistryFix = createRegistryFixPlan;

/**
 * Executes a RegistryFixer fix operation through the Phase 3 framework pipeline.
 *
 * Rails:
 * - Refuses up front if unelevated and any selected target is under HKLM.
 * - Calls framework execute; does NOT reimplement deletion.
 */
export async function executeRegistryFix(
  issues: RegistryFixerIssue[],
  selectedIssueIds?: string[],
  options: RegistryFixOptions = {}
): Promise<RegistryFixerResult> {
  const plan = createRegistryFixPlan(issues, selectedIssueIds, options);

  if (plan.actions.length === 0) {
    if (plan.blocked.length > 0) {
      return {
        success: false,
        fixedCount: 0,
        failedCount: 0,
        message: 'All selected entries were blocked by safety policies.',
      };
    }
    return {
      success: true,
      fixedCount: 0,
      failedCount: 0,
      message: 'No entries selected to fix.',
    };
  }

  // Rail: Refuse to run UNELEVATED if any selected target requires admin (HKLM)
  if (plan.requiresElevation) {
    const elevated = options.isElevatedFn
      ? await options.isElevatedFn()
      : options.runners?.isElevatedFn
      ? await options.runners.isElevatedFn()
      : await isElevated();

    if (!elevated) {
      return {
        success: false,
        fixedCount: 0,
        failedCount: plan.actions.length,
        message:
          'Administrator rights are required to remove registry entries under HKLM. Please relaunch DeskKlean as Administrator.',
      };
    }
  }

  // Execute through framework
  const execResult = await executeOperationPlan(plan.id, options.logActivity, options.runners);

  return {
    success: execResult.success,
    fixedCount: execResult.completed,
    failedCount: execResult.failed,
    backupPath: execResult.backupPath,
    message: execResult.message,
  };
}
