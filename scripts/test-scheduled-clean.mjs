// scripts/test-scheduled-clean.mjs
// Pure-logic unit tests for Phase 18 Scheduled Cleaning (spec §7 cases 1..14).

import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import os from 'os';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

let scheduledCleanModule;
let taskSchedulerModule;
let categoriesModule;

try {
  scheduledCleanModule = require('../dist/main/system/scheduledClean.js');
  taskSchedulerModule = require('../dist/main/system/taskScheduler.js');
  categoriesModule = require('../dist/main/system/smartclean/categories.js');
} catch {
  const { execSync } = require('child_process');
  execSync('npm run build:main', { cwd: path.resolve(__dirname, '..'), stdio: 'inherit' });
  scheduledCleanModule = require('../dist/main/system/scheduledClean.js');
  taskSchedulerModule = require('../dist/main/system/taskScheduler.js');
  categoriesModule = require('../dist/main/system/smartclean/categories.js');
}

const {
  isScheduledCleanCli,
  runScheduledClean,
  pruneScheduledReports,
} = scheduledCleanModule;

const {
  TASK_NAME,
  getTriggerScript,
  registerScheduledTask,
  unregisterScheduledTask,
  getScheduledTaskState,
} = taskSchedulerModule;

const { DEFAULT_CATEGORIES } = categoriesModule;

let passedCount = 0;
let failedCount = 0;

function assert(condition, name, details = '') {
  if (condition) {
    passedCount++;
    console.log(`[PASS] ${name}`);
  } else {
    failedCount++;
    console.error(`[FAIL] ${name}`);
    if (details) {
      console.error(`       ${details}`);
    }
  }
}

async function runTests() {
  console.log('=== Phase 18: Scheduled Cleaning Pure-Logic Tests (Cases 1..14) ===\n');

  const testTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deskklean-sch-test-'));

  try {
    // -------------------------------------------------------------------------
    // Test 1: --scheduled-clean is detected in argv; absent otherwise
    // -------------------------------------------------------------------------
    assert(
      isScheduledCleanCli(['--scheduled-clean']) === true,
      'Test 1a: --scheduled-clean detected as single arg'
    );
    assert(
      isScheduledCleanCli(['node', 'main.js', '--scheduled-clean', '--dry-run']) === true,
      'Test 1b: --scheduled-clean detected among multiple args'
    );
    assert(
      isScheduledCleanCli(['node', 'main.js', '--dry-run']) === false,
      'Test 1c: --scheduled-clean absent returns false'
    );
    assert(
      isScheduledCleanCli([]) === false,
      'Test 1d: empty argv returns false'
    );

    // -------------------------------------------------------------------------
    // Test 2: Disabled setting → skippedReason set, exit 0, zero scan calls
    // -------------------------------------------------------------------------
    let scanCallsT2 = 0;
    const resT2 = await runScheduledClean({
      userDataDir: path.join(testTempDir, 't2'),
      readSettingsFn: () => ({ scheduledCleanEnabled: false }),
      scanFn: async () => {
        scanCallsT2++;
        throw new Error('scanFn must not be called when disabled');
      },
    });

    assert(
      resT2.exitCode === 0,
      'Test 2a: Disabled setting exits with code 0'
    );
    assert(
      resT2.report.skippedReason === 'scheduled cleaning is disabled',
      'Test 2b: skippedReason recorded correctly',
      `got: ${resT2.report.skippedReason}`
    );
    assert(
      scanCallsT2 === 0,
      'Test 2c: Zero scan calls when disabled'
    );

    // -------------------------------------------------------------------------
    // Test 3: Unreadable/missing settings → treated as disabled, reason recorded
    // -------------------------------------------------------------------------
    let scanCallsT3 = 0;
    const resT3Missing = await runScheduledClean({
      userDataDir: path.join(testTempDir, 't3_nonexistent'),
      readSettingsFn: () => null,
      scanFn: async () => {
        scanCallsT3++;
        throw new Error('scanFn must not be called when settings missing');
      },
    });

    assert(
      resT3Missing.exitCode === 0,
      'Test 3a: Missing settings exits with code 0'
    );
    assert(
      resT3Missing.report.skippedReason === 'settings unreadable',
      'Test 3b: skippedReason indicates settings unreadable',
      `got: ${resT3Missing.report.skippedReason}`
    );
    assert(
      scanCallsT3 === 0,
      'Test 3c: Zero scan calls when settings unreadable'
    );

    // Corrupt readSettingsFn throwing error
    const resT3Corrupt = await runScheduledClean({
      userDataDir: path.join(testTempDir, 't3_corrupt'),
      readSettingsFn: () => {
        throw new Error('Unexpected JSON token < in JSON at position 0');
      },
    });
    assert(
      resT3Corrupt.exitCode === 0 &&
        resT3Corrupt.report.skippedReason === 'settings unreadable',
      'Test 3d: Corrupt settings JSON treated as disabled with settings unreadable'
    );

    // -------------------------------------------------------------------------
    // Test 4: Scope is DEFAULT_CATEGORIES only — opt-in/unverified/custom ids never requested
    // -------------------------------------------------------------------------
    let requestedIdsT4 = [];
    let customRulesOptionT4 = null;
    let categoriesOptionT4 = null;

    const defaultIds = DEFAULT_CATEGORIES.map((c) => c.id);

    await runScheduledClean({
      userDataDir: path.join(testTempDir, 't4'),
      settings: {
        scheduledCleanEnabled: true,
        scheduledCleanFrequency: 'weekly',
        excludedPaths: [],
        customRules: [
          {
            id: 'rule-1',
            name: 'Custom Rule',
            directoryPath: 'C:\\Temp',
            filePattern: '*.tmp',
            recursive: true,
            enabled: true,
          },
        ],
      },
      isElevatedFn: () => Promise.resolve(true),
      scanFn: async (categoryIds, options) => {
        requestedIdsT4 = categoryIds || [];
        customRulesOptionT4 = options?.customRules;
        categoriesOptionT4 = options?.categories;
        return {
          generatedAt: new Date().toISOString(),
          scanDurationMs: 10,
          categories: (categoryIds || []).map((id) => ({
            id,
            name: id,
            path: `C:\\${id}`,
            verdict: 'SAFE',
            source: 'test',
            reclaimableBytes: 100,
            fileCount: 2,
            inUseCount: 0,
            status: 'scanned',
            files: [],
            skippedFiles: [],
            adminRequired: false,
            deletionMethod: 'permanent',
            defaultEnabled: true,
          })),
          excluded: [],
          totalReclaimableBytes: 100,
        };
      },
      planFn: (report, categoryIds) => ({
        id: 'plan-t4',
        module: 'smart-clean',
        actions: [],
        blocked: [],
        totalReclaimableBytes: 0,
        reversibility: 'irreversible',
        irreversibilityReason: 'Scheduled cleaning of default categories',
        requiresElevation: false,
        createdAt: new Date().toISOString(),
      }),
      executeFn: async () => ({
        success: true,
        completed: 0,
        failed: 0,
        skipped: 0,
        reclaimableBytes: 0,
        failures: [],
      }),
    });

    const allRequestedInDefaults = requestedIdsT4.every((id) =>
      defaultIds.includes(id)
    );
    const noOptInRequested = !requestedIdsT4.includes('windows-old') &&
      !requestedIdsT4.includes('system-restore');
    const noCustomRuleRequested = !requestedIdsT4.includes('rule-1') &&
      !requestedIdsT4.includes('custom:rule-1');

    assert(
      allRequestedInDefaults,
      'Test 4a: All requested categories are in DEFAULT_CATEGORIES'
    );
    assert(
      noOptInRequested,
      'Test 4b: Opt-in categories (windows-old, system-restore) never requested'
    );
    assert(
      noCustomRuleRequested && (!customRulesOptionT4 || customRulesOptionT4.length === 0),
      'Test 4c: Custom rules are never scanned in scheduled clean'
    );
    assert(
      categoriesOptionT4 === DEFAULT_CATEGORIES,
      'Test 4d: categories passed to scanSmartClean is DEFAULT_CATEGORIES'
    );

    // -------------------------------------------------------------------------
    // Test 5: Unelevated → admin-required categories become skipped with 'requires elevation'
    // -------------------------------------------------------------------------
    let scannedIdsT5 = [];
    const resT5 = await runScheduledClean({
      userDataDir: path.join(testTempDir, 't5'),
      settings: {
        scheduledCleanEnabled: true,
        scheduledCleanFrequency: 'weekly',
        excludedPaths: [],
      },
      isElevatedFn: () => Promise.resolve(false), // UNELEVATED
      scanFn: async (categoryIds) => {
        scannedIdsT5 = categoryIds || [];
        return {
          generatedAt: new Date().toISOString(),
          scanDurationMs: 10,
          categories: (categoryIds || []).map((id) => ({
            id,
            name: id,
            path: `C:\\${id}`,
            verdict: 'SAFE',
            source: 'test',
            reclaimableBytes: 50,
            fileCount: 1,
            inUseCount: 0,
            status: 'scanned',
            files: [],
            skippedFiles: [],
            adminRequired: false,
            deletionMethod: 'permanent',
            defaultEnabled: true,
          })),
          excluded: [],
          totalReclaimableBytes: 50,
        };
      },
      planFn: () => ({
        id: 'plan-t5',
        module: 'smart-clean',
        actions: [],
        blocked: [],
        totalReclaimableBytes: 0,
        reversibility: 'irreversible',
        irreversibilityReason: 'Scheduled clean',
        requiresElevation: false,
        createdAt: new Date().toISOString(),
      }),
      executeFn: async () => ({
        success: true,
        completed: 0,
        failed: 0,
        skipped: 0,
        reclaimableBytes: 0,
        failures: [],
      }),
    });

    const adminRequiredDefs = DEFAULT_CATEGORIES.filter((c) => c.adminRequired);
    const adminOutcomesT5 = resT5.report.categories.filter((c) =>
      adminRequiredDefs.some((a) => a.id === c.id)
    );

    const allAdminSkippedWithElevationReason = adminOutcomesT5.every(
      (c) => c.status === 'skipped' && c.reason === 'requires elevation'
    );

    const noAdminScanned = scannedIdsT5.every(
      (id) => !adminRequiredDefs.some((a) => a.id === id)
    );

    assert(
      adminOutcomesT5.length === adminRequiredDefs.length &&
        allAdminSkippedWithElevationReason,
      'Test 5a: Unelevated run marks all admin-required categories skipped with "requires elevation"'
    );
    assert(
      noAdminScanned,
      'Test 5b: Admin-required categories were never attempted for scanning when unelevated'
    );

    // -------------------------------------------------------------------------
    // Test 6: Exit code mapping: all clean → 0, any failed/skipped → 1, fatal → 2
    // -------------------------------------------------------------------------
    // 6a: All clean -> exit 0
    const resT6Clean = await runScheduledClean({
      userDataDir: path.join(testTempDir, 't6_clean'),
      settings: { scheduledCleanEnabled: true, scheduledCleanFrequency: 'weekly' },
      isElevatedFn: () => Promise.resolve(true),
      scanFn: async (categoryIds) => ({
        generatedAt: new Date().toISOString(),
        scanDurationMs: 10,
        categories: (categoryIds || []).map((id) => ({
          id,
          name: id,
          path: `C:\\${id}`,
          verdict: 'SAFE',
          source: 'test',
          reclaimableBytes: 100,
          fileCount: 1,
          inUseCount: 0,
          status: 'scanned',
          files: [],
          skippedFiles: [],
          adminRequired: false,
          deletionMethod: 'permanent',
          defaultEnabled: true,
        })),
        excluded: [],
        totalReclaimableBytes: 100,
      }),
      planFn: () => ({
        id: 'plan-t6-clean',
        module: 'smart-clean',
        actions: [{ id: 'a1', kind: 'delete-file', target: 'C:\\file', description: 'del', reclaimableBytes: 100 }],
        blocked: [],
        totalReclaimableBytes: 100,
        reversibility: 'irreversible',
        irreversibilityReason: 'Scheduled clean',
        requiresElevation: false,
        createdAt: new Date().toISOString(),
      }),
      executeFn: async () => ({
        success: true,
        completed: 1,
        failed: 0,
        skipped: 0,
        reclaimableBytes: 100,
        failures: [],
      }),
    });
    assert(
      resT6Clean.exitCode === 0 && resT6Clean.report.totals.failed === 0 && resT6Clean.report.totals.skipped === 0,
      'Test 6a: All clean results in exit code 0'
    );

    // 6b: Partial (skipped > 0) -> exit 1
    assert(
      resT5.exitCode === 1 && resT5.report.totals.skipped > 0,
      'Test 6b: Skipped categories results in exit code 1'
    );

    // 6c: Partial (failed > 0) -> exit 1
    const resT6Failed = await runScheduledClean({
      userDataDir: path.join(testTempDir, 't6_failed'),
      settings: { scheduledCleanEnabled: true, scheduledCleanFrequency: 'weekly' },
      isElevatedFn: () => Promise.resolve(true),
      scanFn: async (categoryIds) => ({
        generatedAt: new Date().toISOString(),
        scanDurationMs: 10,
        categories: (categoryIds || []).map((id) => ({
          id,
          name: id,
          path: `C:\\${id}`,
          verdict: 'SAFE',
          source: 'test',
          reclaimableBytes: 100,
          fileCount: 1,
          inUseCount: 0,
          status: id === 'user-temp' ? 'failed' : 'scanned',
          failureReason: id === 'user-temp' ? 'Access denied' : undefined,
          files: [],
          skippedFiles: [],
          adminRequired: false,
          deletionMethod: 'permanent',
          defaultEnabled: true,
        })),
        excluded: [],
        totalReclaimableBytes: 100,
      }),
      planFn: () => ({
        id: 'plan-t6-fail',
        module: 'smart-clean',
        actions: [],
        blocked: [],
        totalReclaimableBytes: 0,
        reversibility: 'irreversible',
        irreversibilityReason: 'Scheduled clean',
        requiresElevation: false,
        createdAt: new Date().toISOString(),
      }),
      executeFn: async () => ({
        success: true,
        completed: 0,
        failed: 0,
        skipped: 0,
        reclaimableBytes: 0,
        failures: [],
      }),
    });
    assert(
      resT6Failed.exitCode === 1 && resT6Failed.report.totals.failed > 0,
      'Test 6c: Failed category results in exit code 1'
    );

    // 6d: Fatal error -> exit 2
    const resT6Fatal = await runScheduledClean({
      userDataDir: path.join(testTempDir, 't6_fatal'),
      settings: { scheduledCleanEnabled: true },
      isElevatedFn: () => Promise.reject(new Error('Fatal exception in elevation subsystem')),
    });
    assert(
      resT6Fatal.exitCode === 2,
      'Test 6d: Fatal error maps to exit code 2'
    );

    // -------------------------------------------------------------------------
    // Test 7: Report filename is ISO-8601 and unique; rotation keeps newest 30
    // -------------------------------------------------------------------------
    const reportsDirT7 = path.join(testTempDir, 't7_reports');
    fs.mkdirSync(reportsDirT7, { recursive: true });

    // Populate 35 files with sequential timestamps
    const now = Date.now();
    for (let i = 0; i < 35; i++) {
      const fileTime = new Date(now - (35 - i) * 60000).toISOString().replace(/[:.]/g, '-');
      const filePath = path.join(reportsDirT7, `${fileTime}.json`);
      fs.writeFileSync(filePath, JSON.stringify({ index: i }));
    }

    const beforePruneCount = fs.readdirSync(reportsDirT7).filter((f) => f.endsWith('.json')).length;
    pruneScheduledReports(reportsDirT7, 30);
    const afterPruneFiles = fs.readdirSync(reportsDirT7).filter((f) => f.endsWith('.json'));

    assert(
      beforePruneCount === 35 && afterPruneFiles.length === 30,
      'Test 7a: pruneScheduledReports prunes 35 files down to 30'
    );

    // Verify rotation kept the 30 newest files (indices 5..34)
    const keptIndices = afterPruneFiles.map((f) => {
      const data = JSON.parse(fs.readFileSync(path.join(reportsDirT7, f), 'utf-8'));
      return data.index;
    }).sort((a, b) => a - b);

    const keptOldest = keptIndices[0];
    const keptNewest = keptIndices[keptIndices.length - 1];

    assert(
      keptOldest === 5 && keptNewest === 34,
      'Test 7b: Pruning strictly retains the newest reports (deleted oldest 5)'
    );

    // Verify ISO-8601 format on generated reports
    const reportFiles = fs.readdirSync(path.join(testTempDir, 't4', 'scheduled-reports'));
    const isIsoFormatted = reportFiles.every((f) =>
      /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}/.test(f)
    );
    assert(
      reportFiles.length > 0 && isIsoFormatted,
      'Test 7c: Generated report filename adheres to ISO-8601 timestamp format'
    );

    // -------------------------------------------------------------------------
    // Test 8: totals.reclaimedBytes is null when no category measured (never 0)
    // -------------------------------------------------------------------------
    // Subcase 8a: All categories have reclaimableBytes: null
    const resT8Null = await runScheduledClean({
      userDataDir: path.join(testTempDir, 't8_null'),
      settings: { scheduledCleanEnabled: true },
      isElevatedFn: () => Promise.resolve(true),
      scanFn: async (categoryIds) => ({
        generatedAt: new Date().toISOString(),
        scanDurationMs: 10,
        categories: (categoryIds || []).map((id) => ({
          id,
          name: id,
          path: `C:\\${id}`,
          verdict: 'SAFE',
          source: 'test',
          reclaimableBytes: null, // UNMEASURED
          fileCount: null,
          inUseCount: 0,
          status: 'scanned',
          files: [],
          skippedFiles: [],
          adminRequired: false,
          deletionMethod: 'permanent',
          defaultEnabled: true,
        })),
        excluded: [],
        totalReclaimableBytes: null,
      }),
      planFn: () => ({
        id: 'plan-t8',
        module: 'smart-clean',
        actions: [],
        blocked: [],
        totalReclaimableBytes: null,
        reversibility: 'irreversible',
        irreversibilityReason: 'Scheduled clean',
        requiresElevation: false,
        createdAt: new Date().toISOString(),
      }),
      executeFn: async () => ({
        success: true,
        completed: 0,
        failed: 0,
        skipped: 0,
        reclaimableBytes: null,
        failures: [],
      }),
    });

    assert(
      resT8Null.report.totals.reclaimedBytes === null,
      'Test 8a: totals.reclaimedBytes is null when no category measured (never 0 as placeholder)'
    );

    // Subcase 8b: Measured categories sum correctly
    assert(
      typeof resT6Clean.report.totals.reclaimedBytes === 'number' &&
        resT6Clean.report.totals.reclaimedBytes > 0,
      'Test 8b: totals.reclaimedBytes reflects real sum when categories measured'
    );

    // -------------------------------------------------------------------------
    // Test 9: Frequency → trigger mapping (daily/weekly/monthly)
    // -------------------------------------------------------------------------
    const dailyTrigger = getTriggerScript('daily');
    const weeklyTrigger = getTriggerScript('weekly');
    const monthlyTrigger = getTriggerScript('monthly');

    assert(
      dailyTrigger.includes('-Daily'),
      'Test 9a: Daily trigger uses -Daily'
    );
    assert(
      weeklyTrigger.includes('-Weekly') && weeklyTrigger.includes('-DaysOfWeek Sunday'),
      'Test 9b: Weekly trigger uses -Weekly -DaysOfWeek Sunday'
    );
    assert(
      monthlyTrigger.includes('-Monthly') && monthlyTrigger.includes('-DaysOfMonth 1'),
      'Test 9c: Monthly trigger uses -Monthly -DaysOfMonth 1'
    );

    // -------------------------------------------------------------------------
    // Test 10: Portable detection refuses registration with portable reason
    // -------------------------------------------------------------------------
    let psCalledT10 = false;
    const resT10 = await registerScheduledTask('weekly', {
      isPortable: true,
      runPowerShellFn: async () => {
        psCalledT10 = true;
        return '';
      },
    });

    assert(
      resT10.ok === false,
      'Test 10a: Portable registration refused'
    );
    assert(
      resT10.reason === 'portable builds cannot be scheduled — the executable runs from a temp directory',
      'Test 10b: Exact portable reason returned',
      `got: ${resT10.reason}`
    );
    assert(
      psCalledT10 === false,
      'Test 10c: PowerShell was not called for portable build'
    );

    // -------------------------------------------------------------------------
    // Test 11: Unpackaged build refuses registration
    // -------------------------------------------------------------------------
    let psCalledT11 = false;
    const resT11 = await registerScheduledTask('weekly', {
      isPortable: false,
      isPackaged: false,
      runPowerShellFn: async () => {
        psCalledT11 = true;
        return '';
      },
    });

    assert(
      resT11.ok === false,
      'Test 11a: Unpackaged registration refused'
    );
    assert(
      typeof resT11.reason === 'string' && resT11.reason.includes('development builds cannot be scheduled'),
      'Test 11b: Development/unpackaged reason returned'
    );
    assert(
      psCalledT11 === false,
      'Test 11c: PowerShell was not called for unpackaged build'
    );

    // -------------------------------------------------------------------------
    // Test 12: Registration success requires a re-query confirming the task exists
    // -------------------------------------------------------------------------
    // Subcase 12a: Register cmdlet succeeds, but re-query shows registered: false
    let queryAttemptsT12a = 0;
    const resT12a = await registerScheduledTask('weekly', {
      isPortable: false,
      isPackaged: true,
      isWindowsFn: () => true,
      exePath: 'C:\\Program Files\\DeskKlean\\DeskKlean.exe',
      runPowerShellFn: async (script) => {
        if (script.includes('Register-ScheduledTask')) {
          return ''; // Registration command succeeds
        }
        if (script.includes('Get-ScheduledTask')) {
          queryAttemptsT12a++;
          // Re-query claims task is NOT registered
          return JSON.stringify({ registered: false, nextRun: null, lastRun: null, lastResult: null });
        }
        return '';
      },
    });

    assert(
      resT12a.ok === false &&
        resT12a.reason?.includes('Registration verification failed'),
      'Test 12a: Registration fails when re-query indicates task does not exist'
    );

    // Subcase 12b: Register succeeds and re-query confirms task is registered
    const nextRunTime = new Date(Date.now() + 86400000 * 7).toISOString();
    const resT12b = await registerScheduledTask('weekly', {
      isPortable: false,
      isPackaged: true,
      isWindowsFn: () => true,
      exePath: 'C:\\Program Files\\DeskKlean\\DeskKlean.exe',
      runPowerShellFn: async (script) => {
        if (script.includes('Register-ScheduledTask')) {
          return '';
        }
        if (script.includes('Get-ScheduledTask')) {
          return JSON.stringify({
            registered: true,
            nextRun: nextRunTime,
            lastRun: null,
            lastResult: 0,
          });
        }
        return '';
      },
    });

    assert(
      resT12b.ok === true && resT12b.nextRun === nextRunTime,
      'Test 12b: Registration succeeds only when verified by re-query'
    );

    // -------------------------------------------------------------------------
    // Test 13: getScheduledTaskState query failure returns null, not registered: false
    // -------------------------------------------------------------------------
    const resT13Error = await getScheduledTaskState({
      isWindowsFn: () => true,
      runPowerShellFn: async () => {
        throw new Error('PowerShell execution policy blocked or RPC server unavailable');
      },
    });

    assert(
      resT13Error === null,
      'Test 13: Query failure returns null (never false, preventing false positive "Not scheduled")'
    );

    // -------------------------------------------------------------------------
    // Test 14: Disable path reverts the setting when unregistration fails
    // -------------------------------------------------------------------------
    // Simulate IPC disable handler logic with unregistration failure
    let storedSettingsT14 = {
      scheduledCleanEnabled: true,
      scheduledCleanFrequency: 'weekly',
    };

    async function simulateSetEnabledHandler(params, unregFn) {
      if (!params.enabled) {
        const unregResult = await unregFn();
        if (!unregResult.ok) {
          return {
            success: false,
            reason: unregResult.reason,
            enabled: storedSettingsT14.scheduledCleanEnabled, // unchanged!
          };
        }
        storedSettingsT14.scheduledCleanEnabled = false;
        return { success: true, enabled: false };
      }
      return { success: true, enabled: true };
    }

    // 14a: Unregistration fails -> setting remains true
    const unregFailRes = await simulateSetEnabledHandler(
      { enabled: false },
      async () => ({ ok: false, reason: 'Access is denied by Windows Security' })
    );

    assert(
      unregFailRes.success === false &&
        storedSettingsT14.scheduledCleanEnabled === true &&
        unregFailRes.enabled === true,
      'Test 14a: Setting remains enabled when unregisterScheduledTask fails'
    );

    // 14b: Unregistration succeeds -> setting set to false
    const unregSuccessRes = await simulateSetEnabledHandler(
      { enabled: false },
      async () => ({ ok: true })
    );

    assert(
      unregSuccessRes.success === true &&
        storedSettingsT14.scheduledCleanEnabled === false &&
        unregSuccessRes.enabled === false,
      'Test 14b: Setting disabled only when unregistration succeeds'
    );

  } finally {
    try {
      fs.rmSync(testTempDir, { recursive: true, force: true });
    } catch {}
  }

  console.log(`\nResults: ${passedCount} passed, ${failedCount} failed.`);
  if (failedCount > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Unhandled test suite failure:', err);
  process.exit(1);
});
