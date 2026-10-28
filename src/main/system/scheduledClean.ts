import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  ScheduledCleanReport,
  ScheduledCategoryOutcome,
  AppSettings,
  SmartCleanReport,
  OperationPlan,
  ExecuteResult,
} from '../../shared/types';
import { DEFAULT_SETTINGS, APP_VERSION } from '../../shared/constants';
import { DEFAULT_CATEGORIES } from './smartclean/categories';
import { scanSmartClean } from './smartclean/scan';
import { createSmartCleanPlan } from './smartclean/execute';
import { executeOperationPlan } from './framework/execute';
import { isElevated } from './elevation';

let electronApp: any;
try {
  electronApp = require('electron').app;
} catch {
  // Standalone node environment
}

export { ScheduledCleanReport, ScheduledCategoryOutcome };

export interface RunScheduledCleanOptions {
  trigger?: 'task-scheduler' | 'manual';
  dryRun?: boolean;
  userDataDir?: string;
  settings?: AppSettings | null;
  readSettingsFn?: () => Promise<AppSettings | null> | AppSettings | null;
  isElevatedFn?: () => Promise<boolean>;
  scanFn?: (
    categoryIds?: string[],
    options?: any
  ) => Promise<SmartCleanReport>;
  planFn?: (
    report: SmartCleanReport,
    categoryIds?: string[],
    options?: any
  ) => OperationPlan;
  executeFn?: (
    planId: string,
    logActivity?: (item: any) => void
  ) => Promise<ExecuteResult>;
  logActivityFn?: (entry: any) => void;
  appVersion?: string;
  env?: NodeJS.ProcessEnv;
}

/**
 * Checks whether the CLI args contain the --scheduled-clean flag.
 */
export function isScheduledCleanCli(argv: string[] = process.argv): boolean {
  return argv.includes('--scheduled-clean');
}

/**
 * Prunes the scheduled reports directory, retaining only the newest maxReports files.
 */
export function pruneScheduledReports(reportsDir: string, maxReports = 30): void {
  try {
    if (!fs.existsSync(reportsDir)) return;
    const files = fs
      .readdirSync(reportsDir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => {
        const fullPath = path.join(reportsDir, f);
        try {
          const stats = fs.statSync(fullPath);
          return { name: f, fullPath, mtimeMs: stats.mtimeMs };
        } catch {
          return { name: f, fullPath, mtimeMs: 0 };
        }
      });

    // Sort descending by mtime; fallback to filename (ISO-8601 names sort chronologically)
    files.sort((a, b) => {
      if (b.mtimeMs !== a.mtimeMs) return b.mtimeMs - a.mtimeMs;
      return b.name.localeCompare(a.name);
    });

    if (files.length > maxReports) {
      const toDelete = files.slice(maxReports);
      for (const item of toDelete) {
        try {
          fs.unlinkSync(item.fullPath);
        } catch {}
      }
    }
  } catch {}
}

/**
 * Appends an activity log item to activity_logs.json in userDataDir.
 */
function recordActivityLog(
  userDataDir: string,
  item: {
    module: string;
    title: string;
    detail: string;
    type: 'info' | 'success' | 'warning' | 'error';
    spaceFreedBytes?: number;
  },
  customLogFn?: (item: any) => void
): void {
  if (customLogFn) {
    try {
      customLogFn(item);
    } catch {}
    return;
  }

  const logsFile = path.join(userDataDir, 'activity_logs.json');
  let logs: any[] = [];
  try {
    if (fs.existsSync(logsFile)) {
      logs = JSON.parse(fs.readFileSync(logsFile, 'utf-8'));
      if (!Array.isArray(logs)) logs = [];
    }
  } catch {}

  const newLog = {
    ...item,
    id: `log-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    timestamp: new Date().toISOString(),
  };

  logs.unshift(newLog);
  if (logs.length > 100) logs.pop();

  try {
    fs.writeFileSync(logsFile, JSON.stringify(logs, null, 2), 'utf-8');
  } catch {}
}

/**
 * Headless scheduled clean runner.
 *
 * Steps per docs/PHASE-18-SCHEDULEDCLEAN.md §3.2:
 * 1. Load settings (missing/corrupt -> treat as disabled, reason 'settings unreadable').
 * 2. Gate (disabled -> exit 0 with skippedReason, scan/delete nothing).
 * 3. Scope: DEFAULT_CATEGORIES only.
 * 4. Elevation: unelevated -> admin-required categories marked skipped with 'requires elevation'.
 * 5. Scan: scanSmartClean.
 * 6. Plan: createSmartCleanPlan.
 * 7. Execute: executeOperationPlan.
 * 8. Report: write JSON report + activity log, prune to newest 30.
 * 9. Exit code: 0 all completed, 1 partial (failed/skipped), 2 fatal.
 */
export async function runScheduledClean(
  opts: RunScheduledCleanOptions = {}
): Promise<{ report: ScheduledCleanReport; exitCode: number }> {
  const startedAt = new Date().toISOString();
  const trigger = opts.trigger || 'task-scheduler';
  const dryRun = Boolean(opts.dryRun);

  const appVersion =
    opts.appVersion ||
    (electronApp && typeof electronApp.getVersion === 'function'
      ? electronApp.getVersion()
      : APP_VERSION);

  const userDataDir =
    opts.userDataDir ||
    (electronApp && typeof electronApp.getPath === 'function'
      ? electronApp.getPath('userData')
      : path.join(os.homedir(), '.deskklean'));

  const reportsDir = path.join(userDataDir, 'scheduled-reports');

  // Helper to persist report, prune, and log
  const finishAndSave = (
    report: ScheduledCleanReport,
    exitCode: number
  ): { report: ScheduledCleanReport; exitCode: number } => {
    try {
      fs.mkdirSync(reportsDir, { recursive: true });
      const isoTimestamp = startedAt.replace(/[:.]/g, '-');
      let filename = `${isoTimestamp}.json`;
      let fullPath = path.join(reportsDir, filename);
      let counter = 1;
      while (fs.existsSync(fullPath)) {
        filename = `${isoTimestamp}-${counter++}.json`;
        fullPath = path.join(reportsDir, filename);
      }
      fs.writeFileSync(fullPath, JSON.stringify(report, null, 2), 'utf-8');
      pruneScheduledReports(reportsDir, 30);
    } catch {}

    const logTitle = report.skippedReason
      ? 'Scheduled Clean Skipped'
      : report.totals.failed > 0 || report.totals.skipped > 0
      ? 'Scheduled Clean (Partial)'
      : 'Scheduled Clean Completed';

    const logType = report.skippedReason
      ? 'info'
      : report.totals.failed > 0
      ? 'warning'
      : 'success';

    const logDetail = report.skippedReason
      ? `Scheduled clean skipped: ${report.skippedReason}`
      : `Scheduled clean finished. ${report.totals.completed} cleaned, ${report.totals.failed} failed, ${report.totals.skipped} skipped.`;

    recordActivityLog(
      userDataDir,
      {
        module: 'smart-clean',
        title: logTitle,
        detail: logDetail,
        type: logType,
        spaceFreedBytes:
          typeof report.totals.reclaimedBytes === 'number'
            ? report.totals.reclaimedBytes
            : undefined,
      },
      opts.logActivityFn
    );

    return { report, exitCode };
  };

  try {
    // Step 1: Load settings
    let settings: AppSettings | null = null;
    let settingsUnreadable = false;

    if (opts.settings !== undefined) {
      settings = opts.settings;
      if (!settings) settingsUnreadable = true;
    } else if (opts.readSettingsFn) {
      try {
        settings = await opts.readSettingsFn();
        if (!settings) settingsUnreadable = true;
      } catch {
        settingsUnreadable = true;
      }
    } else {
      const settingsFile = path.join(userDataDir, 'settings.json');
      try {
        if (fs.existsSync(settingsFile)) {
          const raw = fs.readFileSync(settingsFile, 'utf-8');
          settings = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
        } else {
          settingsUnreadable = true;
        }
      } catch {
        settingsUnreadable = true;
      }
    }

    // Step 2: Gate
    let skippedReason: string | null = null;
    if (settingsUnreadable) {
      skippedReason = 'settings unreadable';
    } else if (!settings?.scheduledCleanEnabled) {
      skippedReason = 'scheduled cleaning is disabled';
    }

    if (skippedReason) {
      const skippedReport: ScheduledCleanReport = {
        startedAt,
        finishedAt: new Date().toISOString(),
        trigger,
        appVersion,
        elevated: false,
        skippedReason,
        categories: [],
        totals: {
          completed: 0,
          failed: 0,
          skipped: 0,
          reclaimedBytes: null,
        },
      };
      return finishAndSave(skippedReport, 0);
    }

    // Step 3 & 4: Scope & Elevation
    const elevated = opts.isElevatedFn
      ? await opts.isElevatedFn()
      : await isElevated();

    // Map outcomes per DEFAULT_CATEGORIES
    const outcomes: Map<string, ScheduledCategoryOutcome> = new Map();

    // Categories that require elevation when unelevated are marked skipped
    const scannableDefs = DEFAULT_CATEGORIES.filter((catDef) => {
      if (!elevated && catDef.adminRequired) {
        outcomes.set(catDef.id, {
          id: catDef.id,
          name: catDef.name,
          status: 'skipped',
          reason: 'requires elevation',
          reclaimedBytes: null,
          filesRemoved: null,
        });
        return false;
      }
      return true;
    });

    const scannableIds = scannableDefs.map((c) => c.id);

    // Step 5: Scan (only DEFAULT_CATEGORIES; never custom rules or opt-in)
    const scanFn = opts.scanFn || scanSmartClean;
    const scanReport = await scanFn(scannableIds, {
      env: opts.env,
      categories: DEFAULT_CATEGORIES,
      customExcludedPaths: settings?.excludedPaths,
    });

    // Check scan outcomes
    const plannableIds: string[] = [];
    for (const catDef of scannableDefs) {
      const scanned = scanReport.categories.find((c) => c.id === catDef.id);
      if (!scanned || scanned.status === 'failed') {
        outcomes.set(catDef.id, {
          id: catDef.id,
          name: catDef.name,
          status: 'failed',
          reason: scanned?.failureReason || 'Category scan failed',
          reclaimedBytes: null,
          filesRemoved: null,
        });
      } else {
        plannableIds.push(catDef.id);
      }
    }

    // Step 6: Plan
    const planFn = opts.planFn || createSmartCleanPlan;
    const plan = planFn(scanReport, plannableIds, {
      customExcludedPaths: settings?.excludedPaths,
    });

    // Check plan blocked actions
    const executableIds: string[] = [];
    for (const catId of plannableIds) {
      const catDef = scannableDefs.find((c) => c.id === catId)!;
      const scanned = scanReport.categories.find((c) => c.id === catId)!;
      const blockedItem = plan.blocked.find(
        (b) => b.target === scanned.path || b.reason.includes(catDef.name)
      );

      if (blockedItem) {
        outcomes.set(catId, {
          id: catDef.id,
          name: catDef.name,
          status: 'failed',
          reason: blockedItem.reason,
          reclaimedBytes: null,
          filesRemoved: null,
        });
      } else {
        executableIds.push(catId);
      }
    }

    // Step 7: Execute
    if (dryRun) {
      // In dry run mode, record planned items without deleting
      for (const catId of executableIds) {
        const catDef = scannableDefs.find((c) => c.id === catId)!;
        const scanned = scanReport.categories.find((c) => c.id === catId)!;
        outcomes.set(catId, {
          id: catDef.id,
          name: catDef.name,
          status: 'cleaned',
          reclaimedBytes: scanned.reclaimableBytes,
          filesRemoved: scanned.fileCount,
        });
      }
    } else if (plan.actions.length === 0) {
      // No actions needed (categories already clean / 0 items)
      for (const catId of executableIds) {
        const catDef = scannableDefs.find((c) => c.id === catId)!;
        const scanned = scanReport.categories.find((c) => c.id === catId)!;
        outcomes.set(catId, {
          id: catDef.id,
          name: catDef.name,
          status: 'cleaned',
          reclaimedBytes: scanned.reclaimableBytes,
          filesRemoved: scanned.fileCount,
        });
      }
    } else {
      const executeFn = opts.executeFn || executeOperationPlan;
      const execResult = await executeFn(plan.id, opts.logActivityFn);

      if (
        !execResult.success &&
        execResult.failures.some(
          (f) => f.target === plan.id || f.target === plan.module
        )
      ) {
        // Global execution failure
        for (const catId of executableIds) {
          const catDef = scannableDefs.find((c) => c.id === catId)!;
          outcomes.set(catId, {
            id: catDef.id,
            name: catDef.name,
            status: 'failed',
            reason: execResult.message || 'Execution failed',
            reclaimedBytes: null,
            filesRemoved: null,
          });
        }
      } else {
        // Evaluate per category
        for (const catId of executableIds) {
          const catDef = scannableDefs.find((c) => c.id === catId)!;
          const scanned = scanReport.categories.find((c) => c.id === catId)!;
          const catActions = plan.actions.filter(
            (a) => a.metadata?.categoryId === catId
          );

          const catFailure = execResult.failures.find((f) =>
            catActions.some((a) => a.target === f.target || a.id === f.target)
          );

          if (catFailure) {
            outcomes.set(catId, {
              id: catDef.id,
              name: catDef.name,
              status: 'failed',
              reason: catFailure.error,
              reclaimedBytes: null,
              filesRemoved: null,
            });
          } else {
            outcomes.set(catId, {
              id: catDef.id,
              name: catDef.name,
              status: 'cleaned',
              reclaimedBytes: scanned.reclaimableBytes,
              filesRemoved: scanned.fileCount,
            });
          }
        }
      }
    }

    // Step 8: Build category outcomes in original DEFAULT_CATEGORIES order
    const categories: ScheduledCategoryOutcome[] = DEFAULT_CATEGORIES.map(
      (catDef) =>
        outcomes.get(catDef.id) || {
          id: catDef.id,
          name: catDef.name,
          status: 'skipped',
          reason: 'unprocessed',
          reclaimedBytes: null,
          filesRemoved: null,
        }
    );

    // Calculate totals
    const completed = categories.filter((c) => c.status === 'cleaned').length;
    const failed = categories.filter((c) => c.status === 'failed').length;
    const skipped = categories.filter((c) => c.status === 'skipped').length;

    // reclaimedBytes is null when NO category had a measured number (never 0 as a stand-in)
    let reclaimedBytes: number | null = null;
    let anyMeasured = false;
    let sumBytes = 0;

    for (const c of categories) {
      if (
        c.status === 'cleaned' &&
        typeof c.reclaimedBytes === 'number' &&
        Number.isFinite(c.reclaimedBytes)
      ) {
        anyMeasured = true;
        sumBytes += c.reclaimedBytes;
      }
    }

    if (anyMeasured) {
      reclaimedBytes = sumBytes;
    }

    // Step 9: Exit code: 0 all completed, 1 partial (failed/skipped), 2 fatal
    const exitCode = failed > 0 || skipped > 0 ? 1 : 0;

    const report: ScheduledCleanReport = {
      startedAt,
      finishedAt: new Date().toISOString(),
      trigger,
      appVersion,
      elevated,
      skippedReason: null,
      categories,
      totals: {
        completed,
        failed,
        skipped,
        reclaimedBytes,
      },
    };

    return finishAndSave(report, exitCode);
  } catch (fatalErr: unknown) {
    const errorMsg =
      fatalErr instanceof Error ? fatalErr.message : String(fatalErr);

    const fatalReport: ScheduledCleanReport = {
      startedAt,
      finishedAt: new Date().toISOString(),
      trigger,
      appVersion,
      elevated: false,
      skippedReason: `Fatal error: ${errorMsg}`,
      categories: [],
      totals: {
        completed: 0,
        failed: 1,
        skipped: 0,
        reclaimedBytes: null,
      },
    };

    return finishAndSave(fatalReport, 2);
  }
}
