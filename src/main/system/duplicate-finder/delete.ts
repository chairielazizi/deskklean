import path from 'path';
import fs from 'fs';
import {
  DuplicateFile,
  DuplicateGroup,
  DuplicateScanResult,
} from '../../../shared/types';
import {
  PlannedAction,
  BlockedAction,
  OperationPlan,
  ExecuteResult,
} from '../framework/types';
import { createOperationPlan, executeOperationPlan, ExecutionRunners } from '../framework';
import { validatePath, normalizePathForComparison } from '../framework/protected';
import { selectKeepCopy } from './keepcopy';

export interface DuplicatePlanOptions {
  scanRoot?: string;
  customExcludedPaths?: string[];
}

/**
 * Creates an OperationPlan for deleting selected duplicate files through the Phase 3 framework.
 *
 * Rails:
 * 1. The plan is generated from the current scan result, NOT from the renderer selection alone.
 *    Any file ID or path not in the scan result cannot appear in the plan.
 * 2. The keep-copy is NEVER a deletion target:
 *    - The module excludes it up-front (never emitted as an action, added to blocked if requested).
 *    - The framework's path validation also refuses it (keep-copy path is placed on protected list).
 * 3. deletionMethod is always 'recycle-bin' (never 'permanent').
 * 4. reclaimableBytes is the exact sum of selected files' sizeBytes from the scan (never estimated).
 * 5. Reversibility is 'reversible'.
 */
export function createDuplicateDeletePlan(
  scanResultOrGroups:
    | DuplicateScanResult
    | DuplicateGroup[]
    | { groups: DuplicateGroup[]; root?: string },
  selectedFileIds?: string[],
  options?: DuplicatePlanOptions
): OperationPlan {
  const groups: DuplicateGroup[] = Array.isArray(scanResultOrGroups)
    ? scanResultOrGroups
    : scanResultOrGroups.groups;

  const rawRoot: string | undefined = !Array.isArray(scanResultOrGroups)
    ? scanResultOrGroups.root
    : options?.scanRoot;

  // Scan root might be multiple roots separated by semicolons (see scan.ts: resolvedRoots.join('; '))
  const scanRoots = rawRoot
    ? rawRoot.split(';').map((r) => r.trim()).filter(Boolean)
    : [];

  const actions: PlannedAction[] = [];
  const blocked: BlockedAction[] = [];

  // Index all files and identify keep-copies
  const scanFilesById = new Map<string, { file: DuplicateFile; group: DuplicateGroup }>();
  const keepCopyByGroup = new Map<string, DuplicateFile>();
  const keepCopyNormPaths = new Set<string>();

  for (const group of groups) {
    let keep = group.files.find((f) => f.isOriginal);
    if (!keep) {
      const winner = selectKeepCopy(
        group.files.map((f) => ({
          path: f.path,
          birthtimeMs: 0,
          name: f.name,
        }))
      );
      keep = group.files.find((f) => f.path === winner.path) || group.files[0];
    }

    keepCopyByGroup.set(group.hash, keep);
    keepCopyNormPaths.add(normalizePathForComparison(keep.path));

    for (const file of group.files) {
      scanFilesById.set(file.id, { file, group });
    }
  }

  // Determine target files to delete
  const targetCandidates: { file: DuplicateFile; group: DuplicateGroup }[] = [];

  if (selectedFileIds !== undefined) {
    // Renderer provided an explicit selection of file IDs
    for (const fileId of selectedFileIds) {
      const entry = scanFilesById.get(fileId);
      // Rail: A file that was not in the scan cannot appear in the plan
      if (!entry) {
        continue;
      }

      const { file, group } = entry;
      const normPath = normalizePathForComparison(file.path);

      // Rail: The keep-copy path is excluded from the plan by the module
      if (file.isOriginal || keepCopyNormPaths.has(normPath)) {
        blocked.push({
          target: file.path,
          reason: 'Keep-copy (original) is protected from deletion',
        });
        continue;
      }

      targetCandidates.push(entry);
    }
  } else {
    // Default selection from the scan result
    for (const group of groups) {
      for (const file of group.files) {
        const normPath = normalizePathForComparison(file.path);
        if (file.isOriginal || keepCopyNormPaths.has(normPath)) {
          continue;
        }
        if (file.selectedForDeletion) {
          targetCandidates.push({ file, group });
        }
      }
    }
  }

  // Framework path validation before every delete
  for (const { file, group } of targetCandidates) {
    const keep = keepCopyByGroup.get(group.hash);

    // Validate path against scan root and protected list.
    // Keep-copy paths are also added to customExcludedPaths as second line of defense!
    let rootToValidate: string | undefined;
    if (scanRoots.length === 1) {
      rootToValidate = scanRoots[0];
    } else if (scanRoots.length > 1) {
      const normFilePath = normalizePathForComparison(file.path);
      rootToValidate = scanRoots.find((r) =>
        normFilePath.startsWith(normalizePathForComparison(r))
      );
    }

    const pathValidation = validatePath(file.path, {
      scanRoot: rootToValidate,
      customExcludedPaths: [
        ...(options?.customExcludedPaths || []),
        ...Array.from(keepCopyNormPaths),
      ],
      allowUserData: true,
      allowNonExistent: false,
    });

    if (!pathValidation.allowed) {
      blocked.push({
        target: file.path,
        reason: pathValidation.reason || `Path validation refused target: ${file.path}`,
      });
      continue;
    }

    const target = pathValidation.resolvedPath || file.path;

    actions.push({
      id: file.id,
      kind: 'delete-file',
      target,
      description: `Move duplicate ${file.name} to Recycle Bin (preserving original: ${keep?.path || 'original'})`,
      reclaimableBytes: file.sizeBytes, // Exact size from scan, never estimated
      metadata: {
        module: 'duplicate-finder',
        deletionMethod: 'recycle-bin', // NEVER 'permanent'
        fileId: file.id,
        hash: group.hash,
        keepCopyPath: keep?.path,
      },
    });
  }

  return createOperationPlan({
    module: 'duplicate-finder',
    actions,
    blocked,
    reversibility: 'reversible',
    requiresElevation: false,
  });
}

/**
 * Executes a Duplicate Finder operation plan through the Phase 3 framework pipeline.
 */
export async function executeDuplicateDelete(
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
  return executeOperationPlan(planId, logActivity, runners);
}
