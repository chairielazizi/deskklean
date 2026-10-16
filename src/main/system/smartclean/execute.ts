import path from 'path';
import {
  SmartCleanReport,
  SmartCleanCategory,
  OperationPlan,
  PlannedAction,
  BlockedAction,
  Reversibility,
  ExecuteResult,
} from '../../../shared/types';
import { createOperationPlan } from '../framework/plan';
import { executeOperationPlan } from '../framework/execute';
import { validatePath } from '../framework/protected';
import { isElevated } from '../elevation';

export interface SmartCleanPlanOptions {
  customExcludedPaths?: string[];
  scanRootOverrides?: Record<string, string>;
  actionGranularity?: 'per-file' | 'per-category';
  isElevatedFn?: () => Promise<boolean>;
}

/**
 * Converts a Phase 5 SmartCleanReport into a Phase 3 framework OperationPlan.
 *
 * Rails:
 * - One PlannedAction per selected category, or per file where the category is a tree root.
 * - reclaimableBytes is THE SUM OF THE SCAN'S REAL MEASUREMENTS for the selected categories. Never re-estimate.
 * - reversibility reflects deletion method: Recycle Bin -> reversible; permanent delete -> irreversible with reason.
 * - Every action carries category id, deletion method, and admin-required flag in metadata.
 * - Validate every path against the protected list before it enters the plan.
 */
export function createSmartCleanPlan(
  report: SmartCleanReport,
  selectedCategoryIds?: string[],
  options: SmartCleanPlanOptions = {}
): OperationPlan {
  // 1. Filter selected categories
  let selectedCategories: SmartCleanCategory[];
  if (selectedCategoryIds && selectedCategoryIds.length > 0) {
    selectedCategories = report.categories.filter((c) => selectedCategoryIds.includes(c.id));
  } else {
    selectedCategories = report.categories.filter((c) => c.defaultEnabled !== false);
  }

  // 2. Determine elevation requirement
  const requiresElevation = selectedCategories.some((c) => Boolean(c.adminRequired));

  // 3. Determine reversibility and consequence reasons (D-R2-4)
  const hasPermanent = selectedCategories.some((c) => c.deletionMethod === 'permanent');
  const reversibility: Reversibility = hasPermanent ? 'irreversible' : 'reversible';

  let irreversibilityReason: string | undefined;
  if (reversibility === 'irreversible') {
    const consequences: string[] = [];
    if (selectedCategories.some((c) => c.id === 'windows-old')) {
      consequences.push(
        'Permanent loss of rollback to previous Windows version (Windows.old removed)'
      );
    }
    if (selectedCategories.some((c) => c.id === 'system-restore')) {
      consequences.push(
        'Permanent loss of all restore points (Volume Shadow Copies deleted via VSS)'
      );
    }
    if (
      selectedCategories.some(
        (c) =>
          c.deletionMethod === 'permanent' &&
          c.id !== 'windows-old' &&
          c.id !== 'system-restore'
      )
    ) {
      consequences.push(
        'Permanent deletion of regenerable system junk, crash dumps, and temporary files (cannot be restored from Recycle Bin)'
      );
    }

    irreversibilityReason =
      consequences.length > 0
        ? consequences.join('; ')
        : 'Permanent deletion of selected items';
  }

  // 4. Construct PlannedAction and BlockedAction items with path validation
  const actions: PlannedAction[] = [];
  const blocked: BlockedAction[] = [];

  for (const cat of selectedCategories) {
    // Categories that failed scanning cannot be acted on; record in blocked
    if (cat.status === 'failed') {
      blocked.push({
        target: cat.path,
        reason: cat.failureReason || `Category "${cat.name}" failed during scan`,
      });
      continue;
    }

    // Special category: Recycle Bin (emptied via Shell COM API, not raw filesystem deletion)
    if (cat.id === 'recycle-bin') {
      actions.push({
        id: cat.id,
        kind: 'delete-tree',
        target: cat.path,
        description: `Empty ${cat.name} (permanent removal of user deleted items)`,
        reclaimableBytes: cat.reclaimableBytes,
        metadata: {
          categoryId: cat.id,
          categoryName: cat.name,
          deletionMethod: cat.deletionMethod || 'permanent',
          adminRequired: Boolean(cat.adminRequired),
          strategy: 'shell',
        },
      });
      continue;
    }

    // Special category: System Restore (deleted via vssadmin, not raw System Volume Information deletion)
    if (cat.id === 'system-restore') {
      actions.push({
        id: cat.id,
        kind: 'delete-tree',
        target: 'vssadmin',
        description: `Delete ${cat.name} via VSS (vssadmin delete shadows)`,
        reclaimableBytes: cat.reclaimableBytes,
        metadata: {
          categoryId: cat.id,
          categoryName: cat.name,
          deletionMethod: cat.deletionMethod || 'permanent',
          adminRequired: Boolean(cat.adminRequired),
          strategy: 'vss',
        },
      });
      continue;
    }

    // Standard filesystem target: check root path against protected list centrally
    const rootValidation = validatePath(cat.path, {
      customExcludedPaths: options.customExcludedPaths,
      allowNonExistent: true,
    });

    if (!rootValidation.allowed) {
      blocked.push({
        target: cat.path,
        reason:
          rootValidation.reason ||
          `Target path is protected by system integrity policy: ${cat.path}`,
      });
      continue;
    }

    const isSingleFile =
      cat.path.toLowerCase().endsWith('.dmp') ||
      cat.path.toLowerCase().endsWith('.log');

    // Decide between per-file action expansion vs category tree action
    const usePerFile =
      options.actionGranularity === 'per-file' ||
      (options.actionGranularity !== 'per-category' &&
        Boolean(cat.files && cat.files.length > 0));

    if (usePerFile && cat.files && cat.files.length > 0) {
      for (let i = 0; i < cat.files.length; i++) {
        const file = cat.files[i];
        const fileValidation = validatePath(file.path, {
          scanRoot: cat.path,
          customExcludedPaths: options.customExcludedPaths,
          allowNonExistent: true,
        });

        if (!fileValidation.allowed) {
          blocked.push({
            target: file.path,
            reason: fileValidation.reason || `Protected path excluded: ${file.path}`,
          });
        } else {
          actions.push({
            id: `${cat.id}-${i}`,
            kind: 'delete-file',
            target: file.path,
            description: `Delete ${path.basename(file.path)} (${cat.name})`,
            reclaimableBytes: file.sizeBytes,
            metadata: {
              categoryId: cat.id,
              categoryName: cat.name,
              deletionMethod: cat.deletionMethod || 'permanent',
              adminRequired: Boolean(cat.adminRequired),
            },
          });
        }
      }
    } else if (
      cat.id === 'windows-old' ||
      isSingleFile ||
      !cat.files ||
      options.actionGranularity === 'per-category'
    ) {
      // Single PlannedAction for Windows.old, single files, or non-file-enumerated categories
      actions.push({
        id: cat.id,
        kind: isSingleFile ? 'delete-file' : 'delete-tree',
        target: cat.path,
        description: `Clean ${cat.name} (${
          cat.deletionMethod === 'recycle-bin'
            ? 'Move to Recycle Bin'
            : 'Permanent delete'
        })`,
        reclaimableBytes: cat.reclaimableBytes,
        metadata: {
          categoryId: cat.id,
          categoryName: cat.name,
          deletionMethod: cat.deletionMethod || 'permanent',
          adminRequired: Boolean(cat.adminRequired),
        },
      });
    }
  }

  // 5. Construct and register OperationPlan with Phase 3 framework
  return createOperationPlan({
    module: 'smart-clean',
    actions,
    blocked,
    reversibility,
    irreversibilityReason,
    requiresElevation,
  });
}

export const planSmartClean = createSmartCleanPlan;

/**
 * Executes a SmartClean operation through the Phase 3 framework pipeline.
 *
 * Rails:
 * - Refuse to run UNELEVATED if any selected category requires admin. Offer a relaunch.
 * - Calls framework execute; does not reimplement deletion.
 */
export async function executeSmartClean(
  report: SmartCleanReport,
  selectedCategoryIds?: string[],
  options: SmartCleanPlanOptions & {
    logActivity?: (item: {
      module: string;
      title: string;
      detail: string;
      type: 'info' | 'success' | 'warning' | 'error';
      spaceFreedBytes?: number;
    }) => void;
    isElevatedFn?: () => Promise<boolean>;
  } = {}
): Promise<ExecuteResult> {
  const plan = createSmartCleanPlan(report, selectedCategoryIds, options);

  // Rail: Refuse to run UNELEVATED if any selected category requires admin.
  if (plan.requiresElevation) {
    const elevated = options.isElevatedFn
      ? await options.isElevatedFn()
      : await isElevated();

    if (!elevated) {
      return {
        success: false,
        completed: 0,
        failed: plan.actions.length,
        skipped: 0,
        reclaimableBytes: null,
        failures: [
          {
            target: 'smart-clean',
            error:
              'Administrator rights are required to execute this operation. Please relaunch DeskKlean as Administrator.',
          },
        ],
        message:
          'Administrator rights are required to execute this operation. Please relaunch DeskKlean as Administrator.',
      };
    }
  }

  // Execute through framework
  return executeOperationPlan(plan.id, options.logActivity);
}
