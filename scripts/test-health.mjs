// scripts/test-health.mjs
// Pure-logic unit tests for Phase 4 Health Check Aggregator.

import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

let health;

try {
  health = require('../dist/main/system/health.js');
} catch {
  const { execSync } = require('child_process');
  execSync('npm run build:main', { cwd: path.resolve(__dirname, '..'), stdio: 'inherit' });
  health = require('../dist/main/system/health.js');
}

let failedCount = 0;
let passedCount = 0;

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

console.log('=== Section 1: Score Derivation & Isolated Deductions ===\n');

// 1. Isolated deductions
{
  // Disk pressure: up to 40 points lost proportional to diskPressure above 70%
  assert(health.calculateDiskPressurePointsLost(50) === 0, '1a. Disk pressure <= 70% loses 0 points');
  assert(health.calculateDiskPressurePointsLost(70) === 0, '1b. Disk pressure at exactly 70% loses 0 points');
  assert(health.calculateDiskPressurePointsLost(85) === 20, '1c. Disk pressure at 85% loses exactly 20 points');
  assert(health.calculateDiskPressurePointsLost(100) === 40, '1d. Disk pressure at 100% loses max 40 points');
  assert(health.calculateDiskPressurePointsLost(120) === 40, '1e. Disk pressure above 100% is capped at 40 points');

  // Reclaimable junk: up to 30 points lost proportional to reclaimableRatio above 5%
  assert(health.calculateReclaimableJunkPointsLost(0.02) === 0, '1f. Reclaimable junk <= 5% loses 0 points');
  assert(health.calculateReclaimableJunkPointsLost(0.05) === 0, '1g. Reclaimable junk at 5% loses 0 points');
  assert(health.calculateReclaimableJunkPointsLost(0.15) === 15, '1h. Reclaimable junk at 15% loses 15 points');
  assert(health.calculateReclaimableJunkPointsLost(0.25) === 30, '1i. Reclaimable junk at 25% loses max 30 points');

  // Boot impact: up to 20 points lost proportional to boot-degradation seconds above 5 s
  assert(health.calculateBootImpactPointsLost(3) === 0, '1j. Boot degradation <= 5s loses 0 points');
  assert(health.calculateBootImpactPointsLost(5) === 0, '1k. Boot degradation at 5s loses 0 points');
  assert(health.calculateBootImpactPointsLost(15) === 10, '1l. Boot degradation at 15s loses 10 points');
  assert(health.calculateBootImpactPointsLost(25) === 20, '1m. Boot degradation at 25s loses max 20 points');

  // Startup count: up to 10 points lost proportional to enabled-item count above 20
  assert(health.calculateStartupCountPointsLost(10) === 0, '1n. Startup count <= 20 loses 0 points');
  assert(health.calculateStartupCountPointsLost(20) === 0, '1o. Startup count at 20 loses 0 points');
  assert(health.calculateStartupCountPointsLost(35) === 5, '1p. Startup count at 35 loses 5 points');
  assert(health.calculateStartupCountPointsLost(50) === 10, '1q. Startup count at 50 loses max 10 points');
}

// 2. Score derivation from disk pressure at launch
{
  assert(health.deriveScoreFromDiskPressure(50) === 100, '2a. Score is 100 when disk pressure is 50%');
  assert(health.deriveScoreFromDiskPressure(70) === 100, '2b. Score is 100 when disk pressure is 70%');
  assert(health.deriveScoreFromDiskPressure(85) === 80, '2c. Score is 80 when disk pressure is 85%');
  assert(health.deriveScoreFromDiskPressure(100) === 60, '2d. Score is 60 when disk pressure is 100%');
}

console.log('\n=== Section 2: Null Score When Zero Components Measured ===\n');

{
  assert(health.deriveScoreFromDiskPressure(null) === null, '3a. deriveScoreFromDiskPressure(null) is strictly null');
  assert(health.deriveScoreFromDiskPressure(NaN) === null, '3b. deriveScoreFromDiskPressure(NaN) is strictly null');

  // When both constituent modules fail or return 0 measurements
  const emptyReport = health.aggregateHealthReport({
    systemInfoResult: { status: 'failed', disks: null, error: new Error('Access denied') },
    startupResult: { status: 'failed', items: null, error: new Error('Registry unavailable') },
  });

  assert(emptyReport.score === null, '3c. Score is strictly null when all constituents fail');
  assert(emptyReport.score !== 0, '3d. Score is NOT 0 when measurements are absent (honest tool rule)');

  const zeroMeasurementReport = health.aggregateHealthReport({
    systemInfoResult: { status: 'ok', disks: [] },
    startupResult: { status: 'failed', items: null },
  });
  assert(zeroMeasurementReport.score === null, '3e. Score is strictly null when 0 measurements are collected');
}

console.log('\n=== Section 3: Issue Derivation Against Documented Thresholds ===\n');

{
  // 1. Disk nearly free: < 10% free
  const issuesNormalDisk = health.deriveIssues([
    { label: 'Free disk space (C:)', value: 15, unit: 'percent', source: 'SystemInfo' },
  ]);
  assert(issuesNormalDisk.length === 0, '4a. Free disk space at 15% produces NO issue');

  const issuesThresholdDisk = health.deriveIssues([
    { label: 'Free disk space (C:)', value: 10, unit: 'percent', source: 'SystemInfo' },
  ]);
  assert(issuesThresholdDisk.length === 0, '4b. Free disk space at exactly 10% produces NO issue');

  const issuesLowDisk = health.deriveIssues([
    { label: 'Free disk space (C:)', value: 8.5, unit: 'percent', source: 'SystemInfo' },
  ]);
  assert(issuesLowDisk.length === 1, '4c. Free disk space at 8.5% (< 10%) triggers Disk nearly free');
  assert(issuesLowDisk[0].measurementRef === 'Free disk space (C:)', '4d. Issue carries exact measurementRef');
  assert(issuesLowDisk[0].module === 'SystemInfo', '4e. Issue module is SystemInfo');
  assert(issuesLowDisk[0].deepLink === 'SystemInfo', '4f. Issue deepLink is SystemInfo');

  // 2. Boot impact high: > 5 s
  const issuesNormalBoot = health.deriveIssues([
    { label: 'Total boot degradation', value: 3.2, unit: 'count', source: 'Startup Optimizer' },
  ]);
  assert(issuesNormalBoot.length === 0, '4g. Boot degradation at 3.2s produces NO issue');

  const issuesThresholdBoot = health.deriveIssues([
    { label: 'Total boot degradation', value: 5.0, unit: 'count', source: 'Startup Optimizer' },
  ]);
  assert(issuesThresholdBoot.length === 0, '4h. Boot degradation at exactly 5.0s produces NO issue');

  const issuesHighBoot = health.deriveIssues([
    { label: 'Total boot degradation', value: 6.8, unit: 'count', source: 'Startup Optimizer' },
  ]);
  assert(issuesHighBoot.length === 1, '4i. Boot degradation at 6.8s triggers Boot impact high');
  assert(issuesHighBoot[0].measurementRef === 'Total boot degradation', '4j. Boot issue carries exact measurementRef');
  assert(issuesHighBoot[0].deepLink === 'Startup Optimizer', '4k. Boot issue deepLink is Startup Optimizer');

  // 3. Startup items high: > 20
  const issuesNormalItems = health.deriveIssues([
    { label: 'Enabled startup items', value: 12, unit: 'count', source: 'Startup Optimizer' },
  ]);
  assert(issuesNormalItems.length === 0, '4l. 12 enabled startup items produces NO issue');

  const issuesThresholdItems = health.deriveIssues([
    { label: 'Enabled startup items', value: 20, unit: 'count', source: 'Startup Optimizer' },
  ]);
  assert(issuesThresholdItems.length === 0, '4m. Exactly 20 enabled startup items produces NO issue');

  const issuesHighItems = health.deriveIssues([
    { label: 'Enabled startup items', value: 24, unit: 'count', source: 'Startup Optimizer' },
  ]);
  assert(issuesHighItems.length === 1, '4n. 24 enabled items triggers Startup items high');
  assert(issuesHighItems[0].measurementRef === 'Enabled startup items', '4o. Items issue carries exact measurementRef');

  // 4. Absent measurements produce NO issues (no filler issues)
  const emptyIssues = health.deriveIssues([]);
  assert(emptyIssues.length === 0, '4p. Empty measurements produce 0 issues (never invented)');
}

console.log('\n=== Section 4: Partial Failure Handling ===\n');

{
  // 1. SystemInfo fails, Startup Optimizer succeeds
  const reportSystemFailed = health.aggregateHealthReport({
    systemInfoResult: { status: 'failed', error: new Error('WMI query timed out') },
    startupResult: {
      status: 'ok',
      items: [
        { id: 'app1', name: 'App 1', enabled: true, estimatedBootImpactMs: 1200 },
        { id: 'app2', name: 'App 2', enabled: false, estimatedBootImpactMs: null },
      ],
    },
  });

  assert(reportSystemFailed.components.length === 4, '5a. Report contains all 4 constituents despite failure');
  const sysComp1 = reportSystemFailed.components.find((c) => c.module === 'SystemInfo');
  const startupComp1 = reportSystemFailed.components.find((c) => c.module === 'Startup Optimizer');
  assert(sysComp1.status === 'failed', '5b. SystemInfo marked as failed');
  assert(sysComp1.measurements.length === 0, '5c. Failed component has 0 measurements (never placeholder)');
  assert(startupComp1.status === 'ok', '5d. Startup Optimizer succeeded with status ok');
  assert(startupComp1.measurements.length > 0, '5e. Startup Optimizer measurements are preserved');

  // 2. Startup Optimizer fails, SystemInfo succeeds
  const reportStartupFailed = health.aggregateHealthReport({
    systemInfoResult: {
      status: 'ok',
      disks: [
        { DeviceID: 'C:', Size: '500000000000', FreeSpace: '100000000000' }, // 80% used -> diskPressure = 80
      ],
    },
    startupResult: { status: 'failed', error: new Error('Registry access denied') },
  });

  const sysComp2 = reportStartupFailed.components.find((c) => c.module === 'SystemInfo');
  const startupComp2 = reportStartupFailed.components.find((c) => c.module === 'Startup Optimizer');
  assert(sysComp2.status === 'ok', '5f. SystemInfo succeeded');
  assert(sysComp2.measurements.length === 3, '5g. SystemInfo measurements present');
  assert(startupComp2.status === 'failed', '5h. Startup Optimizer marked as failed');
  assert(reportStartupFailed.score === 87, '5i. Score computed from measured SystemInfo (100 - (10/30)*40 = 87)');

  // 3. Partial data propagated as partial
  const reportPartialStartup = health.aggregateHealthReport({
    systemInfoResult: {
      status: 'ok',
      disks: [{ DeviceID: 'C:', Size: '500000000000', FreeSpace: '250000000000' }],
    },
    startupResult: {
      status: 'partial',
      items: [
        { id: 'app1', name: 'App 1', enabled: true, estimatedBootImpactMs: null }, // no boot impact
      ],
    },
  });

  const startupComp3 = reportPartialStartup.components.find((c) => c.module === 'Startup Optimizer');
  assert(startupComp3.status === 'partial', '5j. Partial status is propagated as partial');
  const bootMeas = startupComp3.measurements.find((m) => m.label === 'Total boot degradation');
  assert(bootMeas === undefined, '5k. Absent boot impact measurement is omitted, not guessed as 0');
}

console.log('\n=== Section 5: Unmeasured Modules & Deep Links Verification ===\n');

{
  const testReport = health.aggregateHealthReport({
    systemInfoResult: {
      status: 'ok',
      disks: [{ DeviceID: 'C:', Size: '500000000000', FreeSpace: '40000000000' }], // 8% free -> triggers issue
    },
    startupResult: {
      status: 'ok',
      items: Array.from({ length: 25 }, (_, i) => ({
        id: `app${i}`,
        name: `App ${i}`,
        enabled: true,
        estimatedBootImpactMs: 300, // 25 * 300 = 7500ms = 7.5s -> triggers boot impact issue
      })),
    },
  });

  // 1. Unmeasured modules list
  assert(
    Array.isArray(testReport.unmeasured) &&
      testReport.unmeasured.includes('SmartClean') &&
      testReport.unmeasured.includes('DiskAnalyzer'),
    '6a. unmeasured array explicitly lists SmartClean and DiskAnalyzer'
  );

  const smartCleanComp = testReport.components.find((c) => c.module === 'SmartClean');
  const diskAnalyzerComp = testReport.components.find((c) => c.module === 'DiskAnalyzer');
  assert(smartCleanComp && smartCleanComp.status === 'not_built', '6b. SmartClean has status not_built');
  assert(diskAnalyzerComp && diskAnalyzerComp.status === 'not_built', '6c. DiskAnalyzer has status not_built');
  assert(smartCleanComp.measurements.length === 0, '6d. SmartClean has 0 measurements');
  assert(diskAnalyzerComp.measurements.length === 0, '6e. DiskAnalyzer has 0 measurements');

  // 2. Real module names only for HealthMeasurement.source
  const REAL_MODULE_NAMES = new Set(['SystemInfo', 'Startup Optimizer', 'SmartClean', 'DiskAnalyzer']);
  for (const comp of testReport.components) {
    for (const m of comp.measurements) {
      assert(
        REAL_MODULE_NAMES.has(m.source),
        `6f. Measurement "${m.label}" source "${m.source}" matches a real module name`
      );
      assert(typeof m.value === 'number' && !Number.isNaN(m.value), `6g. Value for "${m.label}" is valid number`);
      assert(['bytes', 'count', 'percent'].includes(m.unit), `6h. Unit for "${m.label}" is valid unit`);
    }
  }

  // 3. Deep links point to existing modules
  const allIssues = testReport.components.flatMap((c) => c.issues);
  assert(allIssues.length >= 2, '6i. Derived issues exist for low disk space and high startup count');
  for (const issue of allIssues) {
    assert(
      REAL_MODULE_NAMES.has(issue.deepLink) ||
        ['system-info', 'startup-optimizer', 'smart-clean', 'disk-analyzer'].includes(issue.deepLink),
      `6j. Issue "${issue.description.slice(0, 30)}..." deepLink "${issue.deepLink}" points to a real module`
    );
  }
}

console.log('\n=== Section 6: Provider Injection & End-to-End Aggregation ===\n');

{
  // Test async generateHealthReport with mock providers
  async function runProviderTest() {
    const report = await health.generateHealthReport({
      getLogicalDisks: async () => [
        { DeviceID: 'C:', Size: '1000000000000', FreeSpace: '500000000000' }, // 50% free -> diskPressure = 50%
      ],
      getStartupItems: async () => [
        { id: 'item1', name: 'Item 1', enabled: true, estimatedBootImpactMs: 2500 },
        { id: 'item2', name: 'Item 2', enabled: false, estimatedBootImpactMs: null },
      ],
    });

    assert(report !== null && typeof report === 'object', '7a. generateHealthReport returns report object');
    assert(typeof report.generatedAt === 'string', '7b. generatedAt is ISO string');
    assert(report.score === 100, '7c. Score is 100 with 50% disk pressure');
    assert(report.components.length === 4, '7d. Exactly 4 components returned');
    assert(report.unmeasured.length === 2, '7e. 2 unmeasured modules');

    // Provider rejection test
    const failedReport = await health.generateHealthReport({
      getLogicalDisks: async () => {
        throw new Error('CIM query timeout');
      },
      getStartupItems: async () => [
        { id: 'item1', name: 'Item 1', enabled: true, estimatedBootImpactMs: 1000 },
      ],
    });

    const failedSys = failedReport.components.find((c) => c.module === 'SystemInfo');
    const okStartup = failedReport.components.find((c) => c.module === 'Startup Optimizer');
    assert(failedSys.status === 'failed', '7f. Simulated provider failure marks component as failed');
    assert(okStartup.status === 'ok', '7g. Non-failing provider succeeds');
    assert(failedReport.score === null, '7h. Score is null when disk pressure provider fails');
  }

  await runProviderTest();
}

console.log('\n========================================');
console.log(`Total tests: ${passedCount + failedCount}`);
console.log(`Passed:      ${passedCount}`);
console.log(`Failed:      ${failedCount}`);
console.log('========================================\n');

if (failedCount > 0) {
  process.exit(1);
} else {
  console.log('ALL PHASE 4 HEALTH CHECK TESTS PASSED!\n');
}
