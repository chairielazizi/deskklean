// scripts/test-updater.mjs
// Pure-logic unit tests for Phase 16 Auto-Updater.

import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';
import { EventEmitter } from 'events';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

let updaterModule;

try {
  updaterModule = require('../dist/main/system/updater.js');
} catch {
  const { execSync } = require('child_process');
  execSync('npm run build:main', { cwd: path.resolve(__dirname, '..'), stdio: 'inherit' });
  updaterModule = require('../dist/main/system/updater.js');
}

const {
  checkEnvironmentSupport,
  compareVersions,
  extractReleaseNotes,
  extractProgress,
  isValidTransition,
  createInitialStatus,
  updaterReducer,
  initUpdater,
  getUpdaterStatus,
  checkForUpdates,
  downloadUpdate,
  quitAndInstall,
  resetUpdaterForTesting,
} = updaterModule;

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

async function runTests() {
  console.log('=== Phase 16: Auto-Updater Logic Tests ===\n');

  // 1a & 1b: Failed check yields error, never not-available
  resetUpdaterForTesting();
  class MockFailingUpdater extends EventEmitter {
    async checkForUpdates() {
      throw new Error('net::ERR_INTERNET_DISCONNECTED: feed unreachable');
    }
  }
  const mockFailing = new MockFailingUpdater();
  initUpdater({
    autoUpdater: mockFailing,
    app: { isPackaged: true, getVersion: () => '1.0.1' },
    isPortable: false,
  });

  const res1 = await checkForUpdates();
  assert(
    res1.state === 'error' &&
      res1.error !== null &&
      res1.error.includes('net::ERR_INTERNET_DISCONNECTED'),
    '1a. checkForUpdates rejection yields state: "error" with the message',
    `Actual state: ${res1.state}, error: ${res1.error}`
  );

  assert(
    res1.state !== 'not-available',
    '1b. A failed check never yields state: "not-available"',
    `Actual state: ${res1.state}`
  );

  // 2: lastCheckedAt is null before any check, set after a completed one
  resetUpdaterForTesting();
  initUpdater({
    app: { isPackaged: true, getVersion: () => '1.0.1' },
    isPortable: false,
  });
  const statusBefore = getUpdaterStatus();
  const lastCheckedBefore = statusBefore.lastCheckedAt;

  const checkingState = updaterReducer(statusBefore, { type: 'CHECK_START' });
  const lastCheckedDuring = checkingState.lastCheckedAt;

  const completedState = updaterReducer(checkingState, {
    type: 'CHECK_AVAILABLE',
    version: '1.1.0',
    releaseNotes: null,
  });
  const lastCheckedAfter = completedState.lastCheckedAt;

  assert(
    lastCheckedBefore === null &&
      lastCheckedDuring === null &&
      typeof lastCheckedAfter === 'string' &&
      !isNaN(Date.parse(lastCheckedAfter)),
    '2. lastCheckedAt is null before any check, set after a completed one',
    `Before: ${lastCheckedBefore}, During: ${lastCheckedDuring}, After: ${lastCheckedAfter}`
  );

  // 3: availableVersion is null in idle / checking / error
  const initialStatus = createInitialStatus('1.0.1', 'idle');
  const idleAvail = initialStatus.availableVersion;
  const checkingStatus = updaterReducer(initialStatus, { type: 'CHECK_START' });
  const checkingAvail = checkingStatus.availableVersion;
  const errorStatus = updaterReducer(checkingStatus, {
    type: 'CHECK_ERROR',
    error: 'Network timeout',
  });
  const errorAvail = errorStatus.availableVersion;
  const notAvailStatus = updaterReducer(checkingStatus, { type: 'CHECK_NOT_AVAILABLE' });
  const notAvailVersion = notAvailStatus.availableVersion;

  assert(
    idleAvail === null &&
      checkingAvail === null &&
      errorAvail === null &&
      notAvailVersion === null,
    '3. availableVersion is null in idle / checking / error',
    `idle: ${idleAvail}, checking: ${checkingAvail}, error: ${errorAvail}, not-available: ${notAvailVersion}`
  );

  // 4: Portable detection yields unavailable with a portable message
  resetUpdaterForTesting();
  process.env.PORTABLE_EXECUTABLE_FILE = 'C:\\DeskKlean-Portable.exe';
  initUpdater({
    app: { isPackaged: true, getVersion: () => '1.0.1' },
    isPortable: true,
  });
  const portableStatus = getUpdaterStatus();
  const portableMessage = portableStatus.error || portableStatus.message || '';
  delete process.env.PORTABLE_EXECUTABLE_FILE;

  assert(
    portableStatus.state === 'unavailable' &&
      portableMessage.toLowerCase().includes('portable'),
    '4. Portable detection (PORTABLE_EXECUTABLE_FILE set) yields unavailable with a portable message',
    `State: ${portableStatus.state}, message: ${portableMessage}`
  );

  // 5: !app.isPackaged yields unavailable, not error
  resetUpdaterForTesting();
  initUpdater({
    app: { isPackaged: false, getVersion: () => '1.0.1' },
    isPortable: false,
    isPackaged: false,
  });
  const devStatus = getUpdaterStatus();
  assert(
    devStatus.state === 'unavailable' && devStatus.state !== 'error',
    '5. !app.isPackaged yields unavailable, not error',
    `State: ${devStatus.state}`
  );

  // 6: downloadUpdate() from a non-available state is refused with a reason
  resetUpdaterForTesting();
  initUpdater({
    app: { isPackaged: true, getVersion: () => '1.0.1' },
    isPortable: false,
  });
  let downloadRefusedReason = '';
  try {
    await downloadUpdate();
  } catch (err) {
    downloadRefusedReason = err.message;
  }
  assert(
    downloadRefusedReason.length > 0 &&
      (downloadRefusedReason.includes('available') || downloadRefusedReason.includes('idle')),
    '6. downloadUpdate() from a non-available state is refused with a reason',
    `Reason: ${downloadRefusedReason}`
  );

  // 7: quitAndInstall() from a non-downloaded state is refused with a reason
  let installRefusedReason = '';
  try {
    quitAndInstall();
  } catch (err) {
    installRefusedReason = err.message;
  }
  assert(
    installRefusedReason.length > 0 &&
      (installRefusedReason.includes('downloaded') || installRefusedReason.includes('state')),
    '7. quitAndInstall() from a non-downloaded state is refused with a reason',
    `Reason: ${installRefusedReason}`
  );

  // 8: progressPercent is null when the feed reports no percent
  const p1 = extractProgress({ bytesPerSecond: 524288 });
  const p2 = extractProgress({});
  const p3 = extractProgress({ percent: undefined, bytesPerSecond: 1000 });
  const p4 = extractProgress({ percent: NaN });

  assert(
    p1.percent === null &&
      p2.percent === null &&
      p3.percent === null &&
      p4.percent === null &&
      p1.bytesPerSecond === 524288,
    '8. progressPercent is null when the feed reports no percent',
    `p1: ${JSON.stringify(p1)}, p2: ${JSON.stringify(p2)}, p3: ${JSON.stringify(p3)}, p4: ${JSON.stringify(p4)}`
  );

  // 9: Status transitions are monotonic per attempt: checking → exactly one terminal state
  resetUpdaterForTesting();
  class MockMonotonicUpdater extends EventEmitter {
    async checkForUpdates() {
      this.emit('error', new Error('Primary error event'));
      throw new Error('Secondary rejection error');
    }
  }
  const mockMonotonic = new MockMonotonicUpdater();
  const transitions = [];
  initUpdater({
    autoUpdater: mockMonotonic,
    app: { isPackaged: true, getVersion: () => '1.0.1' },
    isPortable: false,
    onStatusChange: (status) => {
      transitions.push(status.state);
    },
  });

  await checkForUpdates();

  const checkingCount = transitions.filter((s) => s === 'checking').length;
  const terminalCount = transitions.filter(
    (s) => s === 'available' || s === 'not-available' || s === 'error'
  ).length;
  const errorCount = transitions.filter((s) => s === 'error').length;

  assert(
    checkingCount === 1 && terminalCount === 1 && errorCount === 1,
    '9. Status transitions are monotonic per attempt: checking → exactly one terminal state',
    `Transitions recorded: [${transitions.join(', ')}]`
  );

  // 10: releaseNotes passes through unchanged and is null when absent
  const notes1 = extractReleaseNotes('Fixed regression in disk scanner and updated dependencies.');
  const notes2 = extractReleaseNotes(null);
  const notes3 = extractReleaseNotes(undefined);
  const notes4 = extractReleaseNotes('');
  const notes5 = extractReleaseNotes([
    { version: '1.1.0', note: 'Added auto-updater' },
    { version: '1.1.0', note: 'Stability improvements' },
  ]);

  assert(
    notes1 === 'Fixed regression in disk scanner and updated dependencies.' &&
      notes2 === null &&
      notes3 === null &&
      notes4 === null &&
      notes5 === 'Added auto-updater\n\nStability improvements',
    '10. releaseNotes passes through unchanged and is null when absent',
    `notes1: ${notes1}, notes2: ${notes2}, notes3: ${notes3}, notes4: ${notes4}, notes5: ${notes5}`
  );

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
  console.error('Test harness exception:', err);
  process.exit(1);
});
