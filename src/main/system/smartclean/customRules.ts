import fs from 'fs';
import path from 'path';
import {
  CustomCleanRule,
  CustomRuleConfidence,
  CustomRuleFile,
  SkippedFile,
  CustomRuleScanResult,
  CustomRuleValidationResult,
  OperationPlan,
  PlannedAction,
  BlockedAction,
} from '../../../shared/types';
import { resolveEnvPath, globToRegExp } from './scan';
import {
  validatePath,
  resolvePathCrossPlatform,
  normalizePathForComparison,
} from '../framework/protected';
import { createOperationPlan } from '../framework/plan';

export {
  CustomRuleConfidence,
  CustomRuleFile,
  SkippedFile,
  CustomRuleScanResult,
  CustomRuleValidationResult,
};

export interface CustomRuleScanOptions {
  env?: NodeJS.ProcessEnv;
  scanRootOverrides?: Record<string, string>;
  customExcludedPaths?: string[];
  maxFilesCap?: number;
  fileAccessProbe?: (filePath: string) => Promise<void> | void;
}

export interface CustomRulesPlanOptions {
  customExcludedPaths?: string[];
}

/**
 * Validates a CustomCleanRule against the system safety policy.
 *
 * Checks (Phase 17 §2.2):
 * 1. directoryPath non-empty.
 * 2. %VAR% expansion via resolveEnvPath.
 * 3. Result absolute.
 * 4. No ".." traversal segment.
 * 5. Not a drive root (e.g. C:\).
 * 6. Not a UNC path (\\server\share) or mapped network drive.
 * 7. Not inside the protected list (via framework validatePath).
 * 8. filePattern non-empty, free of "..", path separators, and "**".
 */
export function validateCustomRule(
  rule: CustomCleanRule,
  env: NodeJS.ProcessEnv = process.env
): CustomRuleValidationResult {
  if (!rule || typeof rule !== 'object') {
    return { ok: false, reason: 'Invalid rule object' };
  }

  // 1. directoryPath non-empty
  if (typeof rule.directoryPath !== 'string' || !rule.directoryPath.trim()) {
    return { ok: false, reason: 'Directory path must be a non-empty string' };
  }

  const rawPath = rule.directoryPath.trim();

  // 2. Traversal check in raw path
  if (rawPath.includes('..')) {
    return { ok: false, reason: 'Directory path cannot contain ".." traversal segments' };
  }

  // 3. UNC check in raw path (\\server\share or //server/share)
  if (rawPath.startsWith('\\\\') || rawPath.startsWith('//')) {
    return {
      ok: false,
      reason: 'Network paths and UNC shares (\\\\) are not supported for custom rules',
    };
  }

  // 4. filePattern non-empty
  if (typeof rule.filePattern !== 'string' || !rule.filePattern.trim()) {
    return { ok: false, reason: 'File pattern must be a non-empty string' };
  }

  const pattern = rule.filePattern.trim();

  // 5. Pattern semantics narrow (§2.3):
  // - No path separators or ".."
  if (pattern.includes('/') || pattern.includes('\\') || pattern.includes('..')) {
    return { ok: false, reason: 'File pattern cannot contain path separators or ".."' };
  }

  // - No "**" (recursion controlled by rule.recursive)
  if (pattern.includes('**')) {
    return {
      ok: false,
      reason: 'File pattern cannot contain "**" (recursion is controlled by recursive setting)',
    };
  }

  // - No character classes or brace expansion
  if (
    pattern.includes('[') ||
    pattern.includes(']') ||
    pattern.includes('{') ||
    pattern.includes('}')
  ) {
    return {
      ok: false,
      reason: 'File pattern cannot contain character classes or brace expansion',
    };
  }

  // 6. %VAR% expansion
  const resolved = resolveEnvPath(rawPath, env);
  if (!resolved || !resolved.trim()) {
    return { ok: false, reason: 'Failed to resolve environment variables in directory path' };
  }

  // Traversal & UNC check after expansion
  if (resolved.includes('..')) {
    return { ok: false, reason: 'Resolved path cannot contain ".." traversal segments' };
  }
  if (resolved.startsWith('\\\\') || resolved.startsWith('//')) {
    return {
      ok: false,
      reason: 'Network paths and UNC shares (\\\\) are not supported for custom rules',
    };
  }

  // 7. Result absolute
  const isAbs = path.isAbsolute(resolved) || /^[a-zA-Z]:[\\\/]/.test(resolved);
  if (!isAbs) {
    return { ok: false, reason: 'Directory path must resolve to an absolute path' };
  }

  // 8. Drive root check (e.g. C:\ or C: or / or \)
  const isDriveRoot =
    /^[a-zA-Z]:[\\\/]?$/.test(resolved.trim()) ||
    resolved.trim() === '/' ||
    resolved.trim() === '\\';
  if (isDriveRoot) {
    return { ok: false, reason: 'Drive root (e.g. C:\\) cannot be targeted by a custom rule' };
  }

  // 9. Protected list enforcement via framework validatePath
  const pathValidation = validatePath(resolved, { allowNonExistent: true });
  if (!pathValidation.allowed) {
    return {
      ok: false,
      reason:
        pathValidation.reason ||
        `Target path is protected by system integrity policy: ${resolved}`,
    };
  }

  // Also check against custom env variables if provided
  if (env && (env.SystemRoot || env.windir)) {
    const sysRoot = normalizePathForComparison(env.SystemRoot || env.windir || '');
    const normResolved = normalizePathForComparison(resolved);
    if (sysRoot && (normResolved === sysRoot || normResolved.startsWith(sysRoot + '/'))) {
      // Check if it's safe subpath
      if (
        !normResolved.startsWith(sysRoot + '/temp') &&
        !normResolved.startsWith(sysRoot + '/logs')
      ) {
        return {
          ok: false,
          reason: `Target path matches protected system path: ${resolved}`,
        };
      }
    }
  }

  // Check consequence warning for Downloads folder (OQ-CR-4)
  let warning: string | undefined;
  const normResolved = normalizePathForComparison(resolved);
  if (normResolved.endsWith('/downloads')) {
    warning =
      'Targets Downloads folder — matching files will be moved to the Recycle Bin on clean.';
  }

  // Standardize resolvedRoot with proper path separators
  const resolvedRoot = resolvePathCrossPlatform(resolved);

  return { ok: true, resolvedRoot, warning };
}

/**
 * Scans a single custom rule against the filesystem.
 * Produces real measurements or status: 'failed' with failureReason.
 *
 * Rails:
 * - Reparse points never followed (recorded in skippedFiles as 'reparse point').
 * - Missing root produces status: 'failed', reclaimableBytes: null (never 0).
 * - Capped at maxFilesCap (default 5,000) for payload, while reporting real totals.
 * - Source is always 'user-defined rule' and verdict is always 'CONDITIONAL'.
 */
export async function scanCustomRule(
  rule: CustomCleanRule,
  options: CustomRuleScanOptions = {}
): Promise<CustomRuleScanResult> {
  const baseResult: Omit<
    CustomRuleScanResult,
    | 'status'
    | 'failureReason'
    | 'reclaimableBytes'
    | 'fileCount'
    | 'files'
    | 'skippedFiles'
    | 'filesTruncated'
  > = {
    ruleId: rule.id,
    ruleName: rule.name,
    id: `custom:${rule.id}`,
    rootPath: rule.directoryPath,
    verdict: 'CONDITIONAL',
    source: 'user-defined rule',
    deletionMethod: 'recycle-bin',
    confidence: 'user-defined',
  };

  // 1. Validation
  const val = validateCustomRule(rule, options.env);
  if (!val.ok || !val.resolvedRoot) {
    return {
      ...baseResult,
      rootPath: val.resolvedRoot || rule.directoryPath,
      status: 'failed',
      failureReason: val.reason || 'Rule validation failed',
      reclaimableBytes: null,
      fileCount: null,
      files: [],
      skippedFiles: [],
    };
  }

  let rootPath = val.resolvedRoot;
  if (options.scanRootOverrides?.[rule.id]) {
    rootPath = options.scanRootOverrides[rule.id];
  }

  // 2. Check if root exists and is accessible directory
  let rootStat: fs.Stats;
  try {
    rootStat = fs.statSync(rootPath);
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return {
      ...baseResult,
      rootPath,
      status: 'failed',
      failureReason: `Directory does not exist or cannot be accessed: ${errorMsg}`,
      reclaimableBytes: null,
      fileCount: null,
      files: [],
      skippedFiles: [],
    };
  }

  if (!rootStat.isDirectory()) {
    return {
      ...baseResult,
      rootPath,
      status: 'failed',
      failureReason: `Path is not a directory: ${rootPath}`,
      reclaimableBytes: null,
      fileCount: null,
      files: [],
      skippedFiles: [],
    };
  }

  // 3. Walk directory
  const files: CustomRuleFile[] = [];
  const skippedFiles: SkippedFile[] = [];
  let totalReclaimableBytes = 0;
  let totalFileCount = 0;
  let filesTruncated = false;
  const maxCap = options.maxFilesCap ?? 5000;

  const patternRegex = globToRegExp(rule.filePattern);
  const customExcludedNorm = (options.customExcludedPaths || []).map(normalizePathForComparison);

  async function walk(currentDir: string, isRoot: boolean): Promise<void> {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch (err: unknown) {
      skippedFiles.push({
        path: currentDir,
        reason: `Cannot read directory: ${err instanceof Error ? err.message : String(err)}`,
      });
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);

      // Reparse point check: symlink / directory junction
      let isSymlink = false;
      try {
        const lstat = fs.lstatSync(fullPath);
        isSymlink = lstat.isSymbolicLink();
      } catch (err: unknown) {
        skippedFiles.push({
          path: fullPath,
          reason: `Stat failed: ${err instanceof Error ? err.message : String(err)}`,
        });
        continue;
      }

      if (isSymlink) {
        skippedFiles.push({
          path: fullPath,
          reason: 'reparse point',
        });
        continue;
      }

      if (entry.isDirectory()) {
        if (!rule.recursive) {
          // Do not descend if recursive is false
          continue;
        }

        // Check custom excluded paths
        const normDir = normalizePathForComparison(fullPath);
        const isExcluded = customExcludedNorm.some(
          (ex) => normDir === ex || normDir.startsWith(ex + '/')
        );
        if (isExcluded) {
          skippedFiles.push({
            path: fullPath,
            reason: 'Excluded by user path exclusion',
          });
          continue;
        }

        await walk(fullPath, false);
      } else if (entry.isFile()) {
        if (patternRegex.test(entry.name)) {
          try {
            const stat = fs.statSync(fullPath);

            // Verify file accessibility (locked / in-use / unreadable)
            if (options.fileAccessProbe) {
              await options.fileAccessProbe(fullPath);
            } else {
              const fd = fs.openSync(fullPath, 'r');
              fs.closeSync(fd);
            }

            totalReclaimableBytes += stat.size;
            totalFileCount += 1;

            if (files.length < maxCap) {
              files.push({
                path: fullPath,
                sizeBytes: stat.size,
              });
            } else {
              filesTruncated = true;
            }
          } catch (err: unknown) {
            skippedFiles.push({
              path: fullPath,
              reason: `File unreadable: ${err instanceof Error ? err.message : String(err)}`,
            });
          }
        }
      }
    }
  }

  try {
    await walk(rootPath, true);
  } catch (err: unknown) {
    return {
      ...baseResult,
      rootPath,
      status: 'failed',
      failureReason: `Directory walk failed: ${err instanceof Error ? err.message : String(err)}`,
      reclaimableBytes: null,
      fileCount: null,
      files: [],
      skippedFiles,
    };
  }

  return {
    ...baseResult,
    rootPath,
    status: 'ok',
    reclaimableBytes: totalReclaimableBytes,
    fileCount: totalFileCount,
    files,
    skippedFiles,
    ...(filesTruncated ? { filesTruncated: true } : {}),
  };
}

/**
 * Runs all enabled custom rules concurrently without throwing.
 * Failing rules return status: 'failed' with their reason.
 */
export async function scanCustomRules(
  rules: CustomCleanRule[],
  options: CustomRuleScanOptions = {}
): Promise<CustomRuleScanResult[]> {
  if (!Array.isArray(rules) || rules.length === 0) {
    return [];
  }

  // OQ-CR-1: enabled: false rules are omitted from the report, listed in Settings only
  const enabledRules = rules.filter((r) => r.enabled !== false);

  const results = await Promise.all(
    enabledRules.map(async (rule) => {
      try {
        return await scanCustomRule(rule, options);
      } catch (err: unknown) {
        return {
          ruleId: rule.id,
          ruleName: rule.name,
          id: `custom:${rule.id}`,
          rootPath: rule.directoryPath,
          status: 'failed' as const,
          failureReason: `Unexpected error: ${err instanceof Error ? err.message : String(err)}`,
          reclaimableBytes: null,
          fileCount: null,
          files: [],
          skippedFiles: [],
          verdict: 'CONDITIONAL' as const,
          source: 'user-defined rule' as const,
          deletionMethod: 'recycle-bin' as const,
          confidence: 'user-defined' as const,
        };
      }
    })
  );

  return results;
}

/**
 * Builds an OperationPlan of delete-file actions for custom clean rules.
 *
 * Rails:
 * - deletionMethod: 'recycle-bin' on every action (D-R2-4).
 * - Every path is validated through validatePath before entering the plan.
 * - totalReclaimableBytes is null if any selected rule measured null (never guessed as 0).
 * - Reversibility is strictly 'reversible'.
 */
export function createCustomRulesPlan(
  scanResults: CustomRuleScanResult[],
  selectedRuleIds?: string[],
  options: CustomRulesPlanOptions = {}
): OperationPlan {
  // 1. Filter selected results
  let selectedResults: CustomRuleScanResult[];
  if (selectedRuleIds && selectedRuleIds.length > 0) {
    selectedResults = scanResults.filter(
      (r) => selectedRuleIds.includes(r.ruleId) || selectedRuleIds.includes(r.id)
    );
  } else {
    selectedResults = scanResults;
  }

  const actions: PlannedAction[] = [];
  const blocked: BlockedAction[] = [];
  let hasNullMeasurement = false;

  for (const result of selectedResults) {
    if (result.status === 'failed' || result.status === 'skipped') {
      hasNullMeasurement = true;
      blocked.push({
        target: result.rootPath,
        reason:
          result.failureReason || `Custom rule "${result.ruleName}" was not successfully scanned`,
      });
      continue;
    }

    if (result.reclaimableBytes === null) {
      hasNullMeasurement = true;
    }

    // Check root path validation first
    const rootValidation = validatePath(result.rootPath, {
      customExcludedPaths: options.customExcludedPaths,
      allowNonExistent: true,
    });
    if (!rootValidation.allowed) {
      blocked.push({
        target: result.rootPath,
        reason:
          rootValidation.reason ||
          `Target path is protected by system integrity policy: ${result.rootPath}`,
      });
      continue;
    }

    for (let i = 0; i < result.files.length; i++) {
      const file = result.files[i];
      const fileValidation = validatePath(file.path, {
        scanRoot: result.rootPath,
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
          id: `${result.id}-${i}`,
          kind: 'delete-file',
          target: file.path,
          description: `Delete ${path.basename(file.path)} (${result.ruleName})`,
          reclaimableBytes: file.sizeBytes,
          metadata: {
            ruleId: result.ruleId,
            ruleName: result.ruleName,
            deletionMethod: 'recycle-bin',
            adminRequired: false,
            module: 'smartclean-custom',
          },
        });
      }
    }
  }

  const plan = createOperationPlan({
    module: 'smartclean-custom',
    actions,
    blocked,
    reversibility: 'reversible',
    requiresElevation: false,
  });

  if (hasNullMeasurement) {
    plan.totalReclaimableBytes = null;
  }

  return plan;
}
