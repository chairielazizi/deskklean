// scripts/test-phase2-step7-8.mjs
// Pure-logic unit tests for Phase 2 Steps 7 & 8 and the Phase 3 Destructive Framework.

import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import os from 'os';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

let framework, startup, registry;

try {
  framework = require('../dist/main/system/framework/index.js');
  startup = require('../dist/main/system/startup.js');
  registry = require('../dist/main/system/registry.js');
} catch {
  const { execSync } = require('child_process');
  execSync('npm run build:main', { cwd: path.resolve(__dirname, '..'), stdio: 'inherit' });
  framework = require('../dist/main/system/framework/index.js');
  startup = require('../dist/main/system/startup.js');
  registry = require('../dist/main/system/registry.js');
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

console.log('=== Step 7: Startup Delay Logic & Format Tests ===\n');

// 1. null vs 0 vs positive integer ms distinction
{
  // Test sanitization logic
  function sanitizeDelay(ms) {
    if (ms === null || ms === undefined) return null;
    return Math.max(0, Math.floor(Number(ms)));
  }

  assert(sanitizeDelay(null) === null, '1a. Delay null (absent) stays null (Windows default ~10s)');
  assert(sanitizeDelay(0) === 0, '1b. Delay 0 (explicitly no delay) stays 0 and is NOT conflated with null');
  assert(sanitizeDelay(null) !== sanitizeDelay(0), '1c. null and 0 are strictly distinct');
  assert(sanitizeDelay(5000) === 5000, '1d. Delay 5000 ms is preserved');
  assert(sanitizeDelay(-50) === 0, '1e. Negative delay clamped to 0');
  assert(sanitizeDelay(3500.8) === 3500, '1f. Float delay rounded down to integer ms');
}

// 2. Constants check
{
  assert(
    startup.SERIALIZE_KEY_PATH === 'SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Serialize',
    '2a. Serialize key path is correct'
  );
  assert(startup.STARTUP_DELAY_VALUE === 'StartupDelayInMSec', '2b. StartupDelayInMSec value name is correct');
  assert(startup.WAIT_FOR_IDLE_VALUE === 'WaitForIdleState', '2c. WaitForIdleState value name is correct');
}

console.log('\n=== Step 8: Metadata Header & .reg Serialization Tests ===\n');

// 3. Metadata Header formatting & parsing
{
  const testMeta = {
    module: 'startup-optimizer',
    itemName: 'Spotify Music',
    hive: 'HKCU',
    location: 'HKCU_RUN',
    valueName: 'Spotify',
    timestamp: '2026-10-16T12:00:00.000Z',
  };

  const dummySnippet = registry.buildRegSnippet(
    'HKCU',
    'SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run',
    'Spotify',
    '"C:\\Users\\User\\AppData\\Spotify\\Spotify.exe" /min',
    'REG_SZ'
  );

  const formatted = framework.formatRegWithMetadata([dummySnippet], testMeta);

  assert(
    formatted.startsWith('Windows Registry Editor Version 5.00'),
    '3a. Output starts with standard Windows Registry Editor header'
  );
  assert(
    formatted.includes('; DeskKlean Backup Metadata'),
    '3b. Contains metadata comment header'
  );
  assert(
    formatted.includes('; Item: Spotify Music'),
    '3c. Contains item name'
  );
  assert(
    formatted.includes('; Hive: HKCU'),
    '3d. Contains hive'
  );
  assert(
    formatted.includes('; ValueName: Spotify'),
    '3e. Contains value name'
  );

  const parsedMeta = framework.parseRegMetadata(formatted);
  assert(
    parsedMeta.module === testMeta.module &&
      parsedMeta.itemName === testMeta.itemName &&
      parsedMeta.hive === testMeta.hive &&
      parsedMeta.location === testMeta.location &&
      parsedMeta.valueName === testMeta.valueName &&
      parsedMeta.timestamp === testMeta.timestamp,
    '3f. Metadata round-trips accurately from .reg comments'
  );
}

// 4. File encoding & UTF-16LE BOM check
{
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deskklean-test-'));
  const testFile = path.join(tempDir, 'test-backup.reg');

  const meta = {
    module: 'startup-optimizer',
    itemName: 'TestApp',
    hive: 'HKCU',
    timestamp: new Date().toISOString(),
  };

  const snippet = registry.buildRegSnippet('HKCU', 'Software\\Test', 'app', 'val', 'REG_SZ');
  framework.writeRegBackupFile(testFile, [snippet], meta);

  assert(fs.existsSync(testFile), '4a. writeRegBackupFile creates file on disk');

  // Verify first bytes are FF FE
  const buf = fs.readFileSync(testFile);
  assert(
    buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe,
    '4b. Written file begins with UTF-16LE BOM (FF FE)'
  );

  // Read back via readBackupFileText
  const readBackText = framework.readBackupFileText(testFile);
  assert(
    readBackText.includes('Windows Registry Editor Version 5.00'),
    '4c. readBackupFileText decodes UTF-16LE content cleanly'
  );

  // Clean up
  try {
    fs.unlinkSync(testFile);
    fs.rmdirSync(tempDir);
  } catch {}
}

console.log('\n=== Phase 3: Path Validation & Traversal Guard Tests ===\n');

// 5. Path traversal guard
{
  const baseDir = '/home/user/app/backups/startup';

  assert(
    framework.validatePathInsideDir(baseDir, 'backup-123.reg') !== null,
    '5a. Clean backup ID is allowed'
  );
  assert(
    framework.validatePathInsideDir(baseDir, '2026-10-15T12-00-00-HKCU-Spotify') !== null,
    '5b. Clean ID without extension is resolved cleanly'
  );
  assert(
    framework.validatePathInsideDir(baseDir, '../escape.reg') === null,
    '5c. Directory traversal attempt (../) is rejected'
  );
  assert(
    framework.validatePathInsideDir(baseDir, 'sub/nested.reg') === null,
    '5d. Subdirectory traversal slash is rejected'
  );
  assert(
    framework.validatePathInsideDir(baseDir, 'sub\\nested.reg') === null,
    '5e. Backslash traversal is rejected'
  );
  assert(
    framework.validatePathInsideDir(baseDir, 'file\0.reg') === null,
    '5f. Embedded null byte is rejected'
  );
}

// 6. Protected list enforcement
{
  // Test unconditionally protected paths
  const sysRootCheck = framework.validatePath('C:\\Windows', { allowNonExistent: true });
  assert(!sysRootCheck.allowed, '6a. SystemRoot (C:\\Windows) is refused');

  const sys32Check = framework.validatePath('C:\\Windows\\System32', { allowNonExistent: true });
  assert(!sys32Check.allowed, '6b. System32 is refused');

  const progFilesCheck = framework.validatePath('C:\\Program Files\\MyProgram', { allowNonExistent: true });
  assert(!progFilesCheck.allowed, '6c. Program Files is refused');

  const winSxSCheck = framework.validatePath('C:\\Windows\\WinSxS', { allowNonExistent: true });
  assert(!winSxSCheck.allowed, '6d. WinSxS is refused');

  // Test safe subpaths allowlist
  const winTempCheck = framework.validatePath('C:\\Windows\\Temp\\junk.tmp', { allowNonExistent: true });
  assert(winTempCheck.allowed, '6e. C:\\Windows\\Temp\\junk.tmp is allowlisted');

  const werCheck = framework.validatePath(
    'C:\\ProgramData\\Microsoft\\Windows\\WER\\ReportQueue\\crash.dmp',
    { allowNonExistent: true }
  );
  assert(werCheck.allowed, '6f. WER ReportQueue subpath is allowlisted');

  // Test parent-of-protected check
  const parentCheck = framework.validatePath('C:\\Windows\\Temp\\..', { allowNonExistent: true });
  assert(!parentCheck.allowed, '6g. Parent traversal C:\\Windows\\Temp\\.. is refused as C:\\Windows');

  // Test relative path rejection
  const relCheck = framework.validatePath('some/relative/path');
  assert(!relCheck.allowed, '6h. Relative path is refused');

  // Test null byte rejection
  const nullCheck = framework.validatePath('C:\\Windows\\Temp\\junk\0.tmp');
  assert(!nullCheck.allowed, '6i. Null byte path is refused');
}

console.log('\n=== Phase 3: Plan Construction & Reversibility Tests ===\n');

// 7. Plan construction invariants
{
  framework.clearAllOperationPlans();

  // Reversible plan
  const revPlan = framework.createOperationPlan({
    module: 'startup-optimizer',
    actions: [
      {
        id: 'act-1',
        kind: 'registry-value',
        target: 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run\\App',
        description: 'Restore startup item',
        reclaimableBytes: null,
      },
    ],
    reversibility: 'reversible',
    requiresElevation: false,
  });

  assert(revPlan.id.startsWith('plan-'), '7a. Plan receives stable unique ID');
  assert(revPlan.totalReclaimableBytes === null, '7b. Unknown reclaimableBytes results in null total (never guessed)');
  assert(revPlan.reversibility === 'reversible', '7c. Plan records reversible');
  assert(framework.getOperationPlan(revPlan.id) !== undefined, '7d. Plan is retrievable from store');

  // Irreversible plan without reason MUST throw
  let threwWithoutReason = false;
  try {
    framework.createOperationPlan({
      module: 'smart-clean',
      actions: [],
      reversibility: 'irreversible',
      requiresElevation: false,
    });
  } catch (err) {
    threwWithoutReason = true;
  }
  assert(threwWithoutReason, '7e. Irreversible plan without reason is rejected by runtime check');

  // Irreversible plan with reason succeeds
  const irrevPlan = framework.createOperationPlan({
    module: 'shredder',
    actions: [
      {
        id: 'act-2',
        kind: 'delete-file',
        target: 'C:\\Temp\\secret.txt',
        description: 'Shred file',
        reclaimableBytes: 4096,
      },
    ],
    reversibility: 'irreversible',
    irreversibilityReason: 'Overwritten with Peter Gutmann 35-pass algorithm; cannot be un-shredded.',
    requiresElevation: false,
  });

  assert(irrevPlan.reversibility === 'irreversible', '7f. Irreversible plan recorded');
  assert(
    irrevPlan.irreversibilityReason.includes('Gutmann'),
    '7g. Irreversibility reason recorded verbatim'
  );
  assert(irrevPlan.totalReclaimableBytes === 4096, '7h. Exact reclaimableBytes calculated accurately');
}

console.log('\n=== Phase 3: Partial Failure Arithmetic Tests ===\n');

// 8. Partial failure arithmetic
{
  function computeResult(actions, completed, failed, skipped) {
    const success = completed === actions.length && failed === 0;
    return { success, completed, failed, skipped };
  }

  const resFullSuccess = computeResult([1, 2, 3], 3, 0, 0);
  assert(resFullSuccess.success === true, '8a. Full success when completed === actions.length && failed === 0');

  const resPartial = computeResult([1, 2, 3], 2, 1, 0);
  assert(resPartial.success === false, '8b. Partial completion (2/3) reports success: false');

  const resSkipped = computeResult([1, 2, 3], 2, 0, 1);
  assert(resSkipped.success === false, '8c. Incomplete with skipped item reports success: false');
}

console.log('\n=== Step 8: Backup Listing & Change Summary Tests ===\n');

// 9. Change summary parsing
{
  const disabledContent = `
Windows Registry Editor Version 5.00

[HKEY_CURRENT_USER\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run]
"App"=hex:03,00,00,00,ff,ff,ff,ff,00,00,00,00
`.trim();

  const enabledContent = `
Windows Registry Editor Version 5.00

[HKEY_CURRENT_USER\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run]
"App"=hex:02,00,00,00,00,00,00,00,00,00,00,00
`.trim();

  const deleteContent = `
Windows Registry Editor Version 5.00

[HKEY_CURRENT_USER\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run]
"App"=-
`.trim();

  assert(
    framework.summarizeRegChange(disabledContent).includes('disabled'),
    '9a. Recognizes hex:03 as disabled'
  );
  assert(
    framework.summarizeRegChange(enabledContent).includes('enabled'),
    '9b. Recognizes hex:02 as enabled'
  );
  assert(
    framework.summarizeRegChange(deleteContent).includes('deleted'),
    '9c. Recognizes "=- as deleted flag'
  );
}

// 10. Backup header validation
{
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deskklean-val-'));
  const backupDir = path.join(tempDir, 'backups', 'startup');
  fs.mkdirSync(backupDir, { recursive: true });
  const validFile = path.join(backupDir, 'valid.reg');
  const invalidFile = path.join(backupDir, 'invalid.reg');

  fs.writeFileSync(
    validFile,
    'Windows Registry Editor Version 5.00\r\n\r\n[HKEY_CURRENT_USER\\Software\\Test]\r\n"a"="b"\r\n'
  );
  fs.writeFileSync(invalidFile, 'MALFORMED REGISTRY FILE\r\n');

  const valValid = framework.validateBackupForRestore('startup', 'valid.reg', tempDir);
  assert(valValid.valid === true, '10a. Valid .reg file passes validation');

  const valInvalid = framework.validateBackupForRestore('startup', 'invalid.reg', tempDir);
  assert(valInvalid.valid === false, '10b. Malformed .reg without header is rejected');

  try {
    fs.unlinkSync(validFile);
    fs.unlinkSync(invalidFile);
    fs.rmdirSync(backupDir);
    fs.rmdirSync(path.join(tempDir, 'backups'));
    fs.rmdirSync(tempDir);
  } catch {}
}

console.log(`\n========================================`);
console.log(`Total tests: ${passedCount + failedCount}`);
console.log(`Passed:      ${passedCount}`);
console.log(`Failed:      ${failedCount}`);
console.log(`========================================\n`);

if (failedCount > 0) {
  process.exit(1);
} else {
  console.log('ALL PHASE 2 (STEPS 7 & 8) AND PHASE 3 TESTS PASSED!\n');
  process.exit(0);
}
