// scripts/test-secure-erase.mjs
// Pure-logic and filesystem unit tests for Phase 14 Secure Erase.

import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import os from 'os';
import crypto from 'crypto';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

let secureEraseModule;
let frameworkModule;

try {
  secureEraseModule = require('../dist/main/system/secureErase.js');
  frameworkModule = require('../dist/main/system/framework/index.js');
} catch {
  const { execSync } = require('child_process');
  execSync('npm run build:main', { cwd: path.resolve(__dirname, '..'), stdio: 'inherit' });
  secureEraseModule = require('../dist/main/system/secureErase.js');
  frameworkModule = require('../dist/main/system/framework/index.js');
}

const {
  isValidPassCount,
  assertValidPassCount,
  classifyOpenFile,
  calculateFreeSpaceThreshold,
  checkFreeSpaceThreshold,
  calculateHeadroomFloor,
  calculateWipeTargetBytes,
  getWipeTempFilePath,
  sweepLeftoverWipeFiles,
  createShredPlan,
  createFreeSpaceWipePlan,
  isTargetSsd,
  SHRED_IRREVERSIBILITY_REASON,
  WIPE_IRREVERSIBILITY_REASON,
  WIPE_TEMP_FILE_NAME,
  MIN_PASS_COUNT,
  MAX_PASS_COUNT,
} = secureEraseModule;

const {
  createOperationPlan,
  getOperationPlan,
  executeOperationPlan,
  executeOverwriteFiles,
  clearAllOperationPlans,
} = frameworkModule;

let passedCount = 0;
let failedCount = 0;

function assert(condition, name, details = '') {
  if (condition) {
    passedCount++;
    console.log(`[PASS] ${name}`);
  } else {
    failedCount++;
    console.error(`[FAIL] ${name} ${details ? '- ' + details : ''}`);
  }
}

async function runTests() {
  console.log('=== Section 1: Pass Count Validation (D2, Rail 3) ===\n');

  // 1a. 0 rejected
  assert(isValidPassCount(0) === false, '1a. Pass count 0 is rejected by isValidPassCount');
  let err0 = null;
  try {
    assertValidPassCount(0);
  } catch (e) {
    err0 = e;
  }
  assert(err0 !== null, '1b. Pass count 0 throws in assertValidPassCount');

  // 1c. Negative rejected
  assert(isValidPassCount(-1) === false, '1c. Negative pass count -1 is rejected');
  assert(isValidPassCount(-3) === false, '1d. Negative pass count -3 is rejected');
  let errNeg = null;
  try {
    assertValidPassCount(-1);
  } catch (e) {
    errNeg = e;
  }
  assert(errNeg !== null, '1e. Negative pass count throws in assertValidPassCount');

  // 1f. Non-integers rejected (floats, strings, NaN, null, undefined)
  assert(isValidPassCount(1.5) === false, '1f. Float 1.5 is rejected');
  assert(isValidPassCount(2.99) === false, '1g. Float 2.99 is rejected');
  assert(isValidPassCount('2') === false, '1h. String "2" is rejected');
  assert(isValidPassCount(NaN) === false, '1i. NaN is rejected');
  assert(isValidPassCount(null) === false, '1j. null is rejected');
  assert(isValidPassCount(undefined) === false, '1k. undefined is rejected');

  let errFloat = null;
  try {
    assertValidPassCount(1.5);
  } catch (e) {
    errFloat = e;
  }
  assert(errFloat !== null, '1l. Float throws in assertValidPassCount');

  // 1m. 4+ rejected
  assert(isValidPassCount(4) === false, '1m. Pass count 4 is rejected');
  assert(isValidPassCount(7) === false, '1n. Pass count 7 is rejected');
  assert(isValidPassCount(35) === false, '1o. Pass count 35 is rejected');
  let err4 = null;
  try {
    assertValidPassCount(4);
  } catch (e) {
    err4 = e;
  }
  assert(err4 !== null, '1p. Pass count 4 throws in assertValidPassCount');

  // 1q. 1, 2, 3 accepted
  assert(isValidPassCount(1) === true, '1q. Pass count 1 is accepted');
  assert(isValidPassCount(2) === true, '1r. Pass count 2 is accepted');
  assert(isValidPassCount(3) === true, '1s. Pass count 3 is accepted');
  assert(assertValidPassCount(1) === 1, '1t. assertValidPassCount(1) returns 1');
  assert(assertValidPassCount(2) === 2, '1u. assertValidPassCount(2) returns 2');
  assert(assertValidPassCount(3) === 3, '1v. assertValidPassCount(3) returns 3');

  // 1w. createShredPlan rejects invalid passes before handling
  let planErr = null;
  try {
    await createShredPlan(['some/file.txt'], 0);
  } catch (e) {
    planErr = e;
  }
  assert(planErr !== null, '1w. createShredPlan rejects pass count 0 before handling');

  let planErr4 = null;
  try {
    await createShredPlan(['some/file.txt'], 4);
  } catch (e) {
    planErr4 = e;
  }
  assert(planErr4 !== null, '1x. createShredPlan rejects pass count 4 before handling');

  console.log('\n=== Section 2: Free-Space Threshold & Honest Refusal (D4, Rail 1) ===\n');

  const GB = 1024 * 1024 * 1024;
  const MB = 1024 * 1024;

  // 2a. Threshold is max(1% of volume, 100 MB)
  // For a 500 GB volume, 1% is 5 GB (> 100 MB)
  const thresh500G = calculateFreeSpaceThreshold(500 * GB);
  assert(thresh500G === 5 * GB, '2a. Threshold for 500 GB volume is 5 GB (1%)');

  // For a 5 GB volume, 1% is 50 MB, so floor clamps to 100 MB
  const thresh5G = calculateFreeSpaceThreshold(5 * GB);
  assert(thresh5G === 100 * MB, '2b. Threshold for 5 GB volume clamps to 100 MB floor');

  // 2c. Refusal below threshold
  const checkBelow = checkFreeSpaceThreshold(100 * GB, 500 * MB); // 1% is 1 GB, free is 500 MB
  assert(checkBelow.allowed === false, '2c. Volume with free space below threshold is refused');
  assert(
    checkBelow.refusalReason &&
    checkBelow.refusalReason.includes('Free space is below the minimum worth wiping'),
    '2d. Refusal reason states "Free space is below the minimum worth wiping"'
  );
  assert(
    checkBelow.refusalReason && checkBelow.refusalReason.includes('Nothing was overwritten.'),
    '2e. Refusal reason states "Nothing was overwritten."'
  );
  assert(
    !checkBelow.refusalReason?.toLowerCase().includes('insufficient free space'),
    '2f. Honest refusal NEVER says "insufficient free space"'
  );

  // 2g. Proceed above threshold
  const checkAbove = checkFreeSpaceThreshold(100 * GB, 2 * GB); // 1% is 1 GB, free is 2 GB
  assert(checkAbove.allowed === true, '2g. Volume with free space above threshold is allowed');

  // 2h. createFreeSpaceWipePlan below minimum returns plan with 0 actions and 1 blocked action
  const planBelow = await createFreeSpaceWipePlan('C:\\', {
    volumeTotalBytes: 100 * GB,
    volumeFreeBytes: 500 * MB,
  });
  assert(planBelow.actions.length === 0, '2h. Free space below threshold produces 0 planned actions');
  assert(planBelow.blocked.length === 1, '2i. Free space below threshold produces 1 blocked action');
  assert(
    planBelow.blocked[0].reason.includes('Free space is below the minimum worth wiping'),
    '2j. Blocked reason carries honest refusal text'
  );

  console.log('\n=== Section 3: Headroom Floor & Partial Wipe Reporting (D4, Rail 6) ===\n');

  // 3a. Headroom floor is max(1 GB, 5% of volume)
  // For a 100 GB volume, 5% is 5 GB (> 1 GB)
  const floor100G = calculateHeadroomFloor(100 * GB);
  assert(floor100G === 5 * GB, '3a. Headroom floor for 100 GB volume is 5 GB (5%)');

  // For a 10 GB volume, 5% is 500 MB, clamped to 1 GB
  const floor10G = calculateHeadroomFloor(10 * GB);
  assert(floor10G === 1 * GB, '3b. Headroom floor for 10 GB volume clamps to 1 GB floor');

  // 3c. Target wipe bytes = freeBytes - headroomFloorBytes
  const targetCalc = calculateWipeTargetBytes(100 * GB, 20 * GB); // 20 GB free - 5 GB headroom = 15 GB wipe
  assert(targetCalc.wipeBytes === 15 * GB, '3c. Target wipe bytes accurately leaves 5 GB headroom');
  assert(targetCalc.headroomFloorBytes === 5 * GB, '3d. Headroom floor bytes recorded');
  assert(targetCalc.isPartial === true, '3e. Calculation flags wipe as partial because headroom is preserved');

  // 3f. Headroom floor execution stops before full and reports partial
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deskklean-test-wipe-'));
  const testPlan = createOperationPlan({
    module: 'secure-erase',
    actions: [
      {
        id: 'test-wipe-action',
        kind: 'overwrite-file',
        target: path.join(tempDir, WIPE_TEMP_FILE_NAME),
        description: 'Test free-space wipe',
        reclaimableBytes: null,
        metadata: {
          isFreeSpaceWipe: true,
          volumeRoot: tempDir,
          maxWipeBytes: 256 * 1024, // 256 KB test wipe
          headroomFloorBytes: 1 * GB,
          passes: 1,
        },
      },
    ],
    blocked: [],
    reversibility: 'irreversible',
    irreversibilityReason: WIPE_IRREVERSIBILITY_REASON,
    requiresElevation: false,
  });

  const wipeExecResult = await executeOverwriteFiles(testPlan, undefined, {
    isWindowsFn: () => true,
    backupDirOverride: tempDir,
  });

  assert(wipeExecResult.completed === 1, '3f. Free-space wipe completed the planned action');
  assert(wipeExecResult.failed === 0, '3g. Free-space wipe had 0 failures');
  assert(wipeExecResult.success === false, '3h. Free-space wipe reports success: false (partial result per D4)');
  assert(
    wipeExecResult.bytesWritten === 256 * 1024,
    '3i. Free-space wipe reports bytes actually written (256 KB)'
  );
  assert(
    !fs.existsSync(path.join(tempDir, WIPE_TEMP_FILE_NAME)),
    '3j. Free-space wipe temp file deleted in finally block'
  );

  // Clean up testDir
  fs.rmSync(tempDir, { recursive: true, force: true });

  console.log('\n=== Section 4: Irreversibility Declarations (D5, Rail 7) ===\n');

  // 4a. Shred plan reversibility
  const shredPlan = await createShredPlan([], 1);
  assert(shredPlan.reversibility === 'irreversible', '4a. Shred plan declares reversibility: "irreversible"');
  assert(
    shredPlan.irreversibilityReason === SHRED_IRREVERSIBILITY_REASON,
    '4b. Shred plan carries verbatim D5 irreversibility reason'
  );
  assert(
    shredPlan.irreversibilityReason.includes('Overwriting destroys the original bytes') &&
    shredPlan.irreversibilityReason.includes('no backup is made'),
    '4c. Irreversibility reason states no backup is made to protect shredded data'
  );

  // 4d. Wipe plan reversibility
  const wipePlan = await createFreeSpaceWipePlan('C:\\', {
    volumeTotalBytes: 100 * GB,
    volumeFreeBytes: 20 * GB,
  });
  assert(wipePlan.reversibility === 'irreversible', '4d. Wipe plan declares reversibility: "irreversible"');
  assert(
    wipePlan.irreversibilityReason === WIPE_IRREVERSIBILITY_REASON,
    '4e. Wipe plan carries verbatim D5 irreversibility reason'
  );

  console.log('\n=== Section 5: Open-File Classification as Pure Function (D3, OQ-SE-1) ===\n');

  // 5a. Pure classification test cases
  const classLocked = classifyOpenFile('locked');
  assert(classLocked.isBlocked === true, '5a. Probe result "locked" is classified as blocked');
  assert(classLocked.reason === 'file is in use', '5b. "locked" reason is "file is in use"');

  const classIndet = classifyOpenFile('indeterminate');
  assert(
    classIndet.isBlocked === true,
    '5c. Probe result "indeterminate" is classified as blocked (FAIL-CLOSED)'
  );
  assert(
    classIndet.reason !== undefined && classIndet.reason.length > 0,
    '5d. "indeterminate" carries non-empty failure reason'
  );

  const classNotFound = classifyOpenFile('not-found');
  assert(classNotFound.isBlocked === true, '5e. Probe result "not-found" is classified as blocked');

  const classClear = classifyOpenFile('clear');
  assert(classClear.isBlocked === false, '5f. Probe result "clear" is NOT blocked');

  console.log(
    '  [NOTE] The open-file probe itself relies on Windows exclusive handle semantics (tested on host).'
  );
  console.log('         The classification pure function is fully verified on this platform.\n');

  console.log('\n=== Section 6: Partial Failure & Per-File Accounting (D3, Rail 2) ===\n');

  const testSuiteDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deskklean-test-files-'));
  const file1 = path.join(testSuiteDir, 'file1.txt');
  const file2 = path.join(testSuiteDir, 'file2.txt');
  const file3 = path.join(testSuiteDir, 'file3.txt');

  fs.writeFileSync(file1, 'data for file 1 - length 24');
  fs.writeFileSync(file2, 'data for file 2 - length 24');
  fs.writeFileSync(file3, 'data for file 3 - length 24');

  // 6a. Partial failure: 3 files, 1 blocked -> completed: 2, failed: 1, success: false
  // Inject probe that flags file3 as 'locked'
  const mockProbe = (filePath) => {
    if (filePath.includes('file3')) return 'locked';
    return 'clear';
  };

  const partialPlan = await createShredPlan([file1, file2, file3], 1, {
    probeFn: mockProbe,
  });

  assert(partialPlan.actions.length === 2, '6a. Plan contains 2 unblocked actions');
  assert(partialPlan.blocked.length === 1, '6b. Plan contains 1 blocked action');
  assert(partialPlan.blocked[0].target.includes('file3'), '6c. file3 is the blocked target');
  assert(partialPlan.blocked[0].reason === 'file is in use', '6d. Blocked reason is "file is in use"');

  const partialExec = await executeOverwriteFiles(partialPlan, undefined, {
    isWindowsFn: () => true,
    backupDirOverride: testSuiteDir,
  });

  // Calculate composite result as SHRED_ITEMS handler does:
  const totalCompleted = partialExec.completed;
  const totalFailed = partialExec.failed + partialPlan.blocked.length;
  const compositeSuccess = partialExec.success && partialPlan.blocked.length === 0;

  assert(totalCompleted === 2, '6e. Exactly 2 files completed');
  assert(totalFailed === 1, '6f. Exactly 1 file failed/blocked');
  assert(compositeSuccess === false, '6g. Partial failure returns success: false');

  // 6h. Per-file accounting: nonexistent path is NOT counted as shredded
  const ghostFile = path.join(testSuiteDir, 'ghost-nonexistent.txt');
  const ghostPlan = createOperationPlan({
    module: 'secure-erase',
    actions: [
      {
        id: 'action-ghost',
        kind: 'overwrite-file',
        target: ghostFile,
        description: 'Shred nonexistent file',
        reclaimableBytes: 1000,
        metadata: { passes: 1 },
      },
    ],
    blocked: [],
    reversibility: 'irreversible',
    irreversibilityReason: SHRED_IRREVERSIBILITY_REASON,
    requiresElevation: false,
  });

  const ghostExec = await executeOverwriteFiles(ghostPlan, undefined, {
    isWindowsFn: () => true,
    backupDirOverride: testSuiteDir,
  });

  assert(ghostExec.completed === 0, '6h. Nonexistent path is NOT counted as completed (completed === 0)');
  assert(ghostExec.failed === 1, '6i. Nonexistent path is counted as failed (failed === 1)');
  assert(ghostExec.success === false, '6j. Nonexistent target results in success: false');
  assert(ghostExec.bytesWritten === 0, '6k. Nonexistent target writes 0 bytes');

  console.log('\n=== Section 7: Overwrite-File Executor Mechanics (Step 1, Rail 4) ===\n');

  // 7a. Real overwrite with passes × length
  const realFile = path.join(testSuiteDir, 'shred-me.txt');
  const payload = 'Confidential Bank Statement 2026';
  fs.writeFileSync(realFile, payload);
  const realSize = Buffer.byteLength(payload);

  const shredRealPlan = createOperationPlan({
    module: 'secure-erase',
    actions: [
      {
        id: 'action-real',
        kind: 'overwrite-file',
        target: realFile,
        description: 'Shred confidential file 2 passes',
        reclaimableBytes: realSize,
        metadata: { passes: 2 },
      },
    ],
    blocked: [],
    reversibility: 'irreversible',
    irreversibilityReason: SHRED_IRREVERSIBILITY_REASON,
    requiresElevation: false,
  });

  const shredExec = await executeOverwriteFiles(shredRealPlan, undefined, {
    isWindowsFn: () => true,
    backupDirOverride: testSuiteDir,
  });

  assert(shredExec.completed === 1, '7a. Overwrite-file executor completes real file');
  assert(shredExec.failed === 0, '7b. Overwrite-file executor has 0 failures');
  assert(shredExec.success === true, '7c. Overwrite-file executor returns success: true on clean run');
  assert(
    shredExec.bytesWritten === realSize * 2,
    `7d. Bytes written (${shredExec.bytesWritten}) equals exactly size × passes (${realSize * 2})`
  );
  assert(!fs.existsSync(realFile), '7e. File is deleted only after every pass completed');

  // Clean up testSuiteDir
  fs.rmSync(testSuiteDir, { recursive: true, force: true });

  console.log('\n=== Section 8: SSD vs HDD Honesty Detection (Step 4, OQ-SE-3) ===\n');

  // 8a. SSD detection with MediaType = 4 returns true
  const ssdResult = await isTargetSsd('C:\\', {
    getPartitionsFn: async () => [{ DriveLetter: 'C', DiskNumber: 0 }],
    getPhysicalDisksFn: async () => [{ DeviceId: '0', MediaType: 4 }],
  });
  assert(ssdResult === true, '8a. MediaType 4 detected accurately as SSD (true)');

  // 8b. HDD detection with MediaType = 3 returns false
  const hddResult = await isTargetSsd('D:\\', {
    getPartitionsFn: async () => [{ DriveLetter: 'D', DiskNumber: 1 }],
    getPhysicalDisksFn: async () => [{ DeviceId: '1', MediaType: 3 }],
  });
  assert(hddResult === false, '8b. MediaType 3 detected accurately as HDD (false)');

  // 8c. Indeterminate / missing provider returns null
  const indetResult = await isTargetSsd('C:\\', {
    getPartitionsFn: async () => [],
    getPhysicalDisksFn: async () => [],
  });
  assert(indetResult === null, '8c. Indeterminate disk configuration returns null');

  console.log('\n========================================');
  console.log(`Total tests: ${passedCount + failedCount}`);
  console.log(`Passed:      ${passedCount}`);
  console.log(`Failed:      ${failedCount}`);
  console.log('========================================\n');

  if (failedCount > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Fatal error during test suite:', err);
  process.exit(1);
});
