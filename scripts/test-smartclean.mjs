// scripts/test-smartclean.mjs
// Pure-logic unit tests for Phase 5 SmartClean (Read-Only Scan).

import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import os from 'os';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

let categoriesModule;
let scanModule;
let protectedModule;

try {
  categoriesModule = require('../dist/main/system/smartclean/categories.js');
  scanModule = require('../dist/main/system/smartclean/scan.js');
  protectedModule = require('../dist/main/system/framework/protected.js');
} catch {
  const { execSync } = require('child_process');
  execSync('npm run build:main', { cwd: path.resolve(__dirname, '..'), stdio: 'inherit' });
  categoriesModule = require('../dist/main/system/smartclean/categories.js');
  scanModule = require('../dist/main/system/smartclean/scan.js');
  protectedModule = require('../dist/main/system/framework/protected.js');
}

const {
  DEFAULT_CATEGORIES,
  OPT_IN_CATEGORIES,
  UNVERIFIED_CATEGORIES,
  ALL_CANDIDATE_CATEGORIES,
  EXCLUDED_CATEGORIES,
} = categoriesModule;

const {
  resolveEnvPath,
  globToRegExp,
  isFileInUseError,
  scanCategory,
  scanSmartClean,
} = scanModule;

const { validatePath } = protectedModule;

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
  console.log('=== Section 1: Category Table & Verdict Consistency ===\n');

  // 1. Verdict consistency: every DEFAULT category is SAFE
  for (const cat of DEFAULT_CATEGORIES) {
    assert(
      cat.verdict === 'SAFE',
      `1a. Default category "${cat.id}" has SAFE verdict`,
      `Expected SAFE, got ${cat.verdict}`
    );
    assert(
      typeof cat.source === 'string' && cat.source.startsWith('https://'),
      `1b. Default category "${cat.id}" cites a valid HTTPS source`,
      `Source was: ${cat.source}`
    );
    assert(
      cat.defaultEnabled === true,
      `1c. Default category "${cat.id}" is defaultEnabled: true`
    );
  }

  // 2. Verdict consistency: every OPT-IN category is CONDITIONAL
  for (const cat of OPT_IN_CATEGORIES) {
    assert(
      cat.verdict === 'CONDITIONAL',
      `2a. Opt-in category "${cat.id}" has CONDITIONAL verdict`,
      `Expected CONDITIONAL, got ${cat.verdict}`
    );
    assert(
      cat.defaultEnabled === false,
      `2b. Opt-in category "${cat.id}" is defaultEnabled: false`
    );
    assert(
      typeof cat.consequence === 'string' && cat.consequence.length > 0,
      `2c. Opt-in category "${cat.id}" states its deletion consequence`
    );
    assert(
      typeof cat.source === 'string' && cat.source.startsWith('https://'),
      `2d. Opt-in category "${cat.id}" cites a valid HTTPS source`
    );
  }

  // 3. Unverified paths must NOT be in the default set
  for (const cat of UNVERIFIED_CATEGORIES) {
    assert(
      cat.defaultEnabled === false,
      `3a. Unverified candidate "${cat.id}" is NOT enabled by default`
    );
    assert(
      cat.isUnverified === true,
      `3b. Candidate "${cat.id}" is explicitly marked isUnverified: true`
    );
    assert(
      !DEFAULT_CATEGORIES.some((c) => c.id === cat.id),
      `3c. Unverified candidate "${cat.id}" is absent from DEFAULT_CATEGORIES`
    );
  }

  // 4. Excluded categories: never scanned, never cleaned, distinct reasons
  const candidateIds = new Set(ALL_CANDIDATE_CATEGORIES.map((c) => c.id));
  const candidatePaths = new Set(ALL_CANDIDATE_CATEGORIES.map((c) => c.rawPath.toLowerCase()));

  for (const exc of EXCLUDED_CATEGORIES) {
    assert(
      exc.verdict === 'RISKY' || exc.verdict === 'CONDITIONAL',
      `4a. Excluded category "${exc.name}" has RISKY or CONDITIONAL verdict`,
      `Verdict was: ${exc.verdict}`
    );
    assert(
      typeof exc.reason === 'string' && exc.reason.length > 10,
      `4b. Excluded category "${exc.name}" has detailed non-empty reason`
    );
    assert(
      typeof exc.source === 'string' && exc.source.startsWith('https://'),
      `4c. Excluded category "${exc.name}" cites official documentation`
    );
    assert(
      !candidatePaths.has(exc.path.toLowerCase()),
      `4d. Excluded path "${exc.path}" does not appear in candidate category paths`
    );
  }

  console.log('\n=== Section 2: Path Resolution from Environment Variables ===\n');

  // 5. Environment variable path resolution
  {
    const mockEnv = {
      LOCALAPPDATA: 'C:\\Users\\MockTester\\AppData\\Local',
      APPDATA: 'C:\\Users\\MockTester\\AppData\\Roaming',
      SystemRoot: 'C:\\Windows',
      SystemDrive: 'C:',
      ProgramData: 'C:\\ProgramData',
      USERPROFILE: 'C:\\Users\\MockTester',
    };

    const resolvedUserTemp = resolveEnvPath('%LOCALAPPDATA%\\Temp', mockEnv);
    assert(
      resolvedUserTemp === 'C:\\Users\\MockTester\\AppData\\Local\\Temp',
      '5a. Resolves %LOCALAPPDATA%\\Temp without hardcoding usernames',
      `Got: ${resolvedUserTemp}`
    );

    const resolvedSysTemp = resolveEnvPath('%SystemRoot%\\Temp', mockEnv);
    assert(
      resolvedSysTemp === 'C:\\Windows\\Temp',
      '5b. Resolves %SystemRoot%\\Temp accurately',
      `Got: ${resolvedSysTemp}`
    );

    const resolvedProgData = resolveEnvPath('%ProgramData%\\Microsoft\\Windows\\WER', mockEnv);
    assert(
      resolvedProgData === 'C:\\ProgramData\\Microsoft\\Windows\\WER',
      '5c. Resolves %ProgramData% accurately',
      `Got: ${resolvedProgData}`
    );

    // Case-insensitivity check
    const resolvedLower = resolveEnvPath('%localappdata%\\Temp', mockEnv);
    assert(
      resolvedLower === 'C:\\Users\\MockTester\\AppData\\Local\\Temp',
      '5d. Resolves lowercase %localappdata% case-insensitively',
      `Got: ${resolvedLower}`
    );

    const resolvedMixed = resolveEnvPath('%systemroot%\\MEMORY.DMP', mockEnv);
    assert(
      resolvedMixed === 'C:\\Windows\\MEMORY.DMP',
      '5e. Resolves lowercase %systemroot% case-insensitively',
      `Got: ${resolvedMixed}`
    );

    // Fallback when env vars are missing
    const resolvedFallback = resolveEnvPath('%SystemRoot%\\Temp', {});
    assert(
      resolvedFallback === 'C:\\Windows\\Temp',
      '5f. Falls back gracefully to default Windows root when SystemRoot absent',
      `Got: ${resolvedFallback}`
    );
  }

  console.log('\n=== Section 3: Protected-List Enforcement ===\n');

  // 6. Central protected list check
  {
    const mockEnv = {
      SystemRoot: 'C:\\Windows',
      ProgramFiles: 'C:\\Program Files',
      ProgramData: 'C:\\ProgramData',
      SystemDrive: 'C:',
      USERPROFILE: 'C:\\Users\\Alice',
    };

    // Protected paths refusal
    const resSysRoot = await scanCategory(
      {
        id: 'test-sysroot',
        name: 'Target Windows Root',
        description: 'Testing protected refusal',
        rawPath: 'C:\\Windows',
        strategy: 'fixed',
        defaultEnabled: true,
        adminRequired: true,
        verdict: 'SAFE',
        source: 'https://learn.microsoft.com',
        deletionMethod: 'permanent',
      },
      { env: mockEnv }
    );
    assert(
      resSysRoot.status === 'failed',
      '6a. Category targeting C:\\Windows is refused by protected list',
      `Status was: ${resSysRoot.status}`
    );
    assert(
      resSysRoot.reclaimableBytes === null,
      '6b. Refused category reclaimableBytes is strictly null (never 0)',
      `Got: ${resSysRoot.reclaimableBytes}`
    );
    assert(
      typeof resSysRoot.failureReason === 'string' &&
        resSysRoot.failureReason.toLowerCase().includes('protected'),
      '6c. Failure reason mentions protected path policy',
      `Reason: ${resSysRoot.failureReason}`
    );

    // Target C:\Program Files
    const resProgFiles = await scanCategory(
      {
        id: 'test-progfiles',
        name: 'Target Program Files',
        description: 'Testing protected refusal',
        rawPath: 'C:\\Program Files',
        strategy: 'fixed',
        defaultEnabled: true,
        adminRequired: true,
        verdict: 'SAFE',
        source: 'https://learn.microsoft.com',
        deletionMethod: 'permanent',
      },
      { env: mockEnv }
    );
    assert(
      resProgFiles.status === 'failed',
      '6d. Category targeting C:\\Program Files is refused'
    );

    // Target C:\Windows\WinSxS
    const resWinSxS = await scanCategory(
      {
        id: 'test-winsxs',
        name: 'Target WinSxS',
        description: 'Testing protected refusal',
        rawPath: 'C:\\Windows\\WinSxS',
        strategy: 'fixed',
        defaultEnabled: true,
        adminRequired: true,
        verdict: 'SAFE',
        source: 'https://learn.microsoft.com',
        deletionMethod: 'permanent',
      },
      { env: mockEnv }
    );
    assert(
      resWinSxS.status === 'failed',
      '6e. Category targeting C:\\Windows\\WinSxS is refused'
    );

    // Safe allowlisted subpath under SystemRoot (C:\Windows\Temp)
    const safeCheck = validatePath('C:\\Windows\\Temp\\test.tmp', { allowNonExistent: true });
    assert(
      safeCheck.allowed === true,
      '6f. Safe allowlisted subpath C:\\Windows\\Temp is permitted'
    );

    const safeWer = validatePath('C:\\ProgramData\\Microsoft\\Windows\\WER\\ReportQueue\\dump.wer', {
      allowNonExistent: true,
    });
    assert(
      safeWer.allowed === true,
      '6g. Safe allowlisted WER ReportQueue subpath is permitted'
    );
  }

  console.log('\n=== Section 4: Unreadable / Missing Path Handling ===\n');

  // 7. Non-existent path returns failed status with reason, never 0, never estimated
  {
    const missingDir = path.join(os.tmpdir(), `deskklean-nonexistent-${Date.now()}`);
    const res = await scanCategory({
      id: 'test-missing',
      name: 'Non-existent Directory',
      description: 'Testing missing directory handling',
      rawPath: missingDir,
      strategy: 'fixed',
      defaultEnabled: true,
      adminRequired: false,
      verdict: 'SAFE',
      source: 'https://learn.microsoft.com',
      deletionMethod: 'permanent',
    });

    assert(
      res.status === 'failed',
      '7a. Non-existent directory reports status: "failed"',
      `Status was: ${res.status}`
    );
    assert(
      res.reclaimableBytes === null,
      '7b. Missing category reclaimableBytes is strictly null (never 0)',
      `Got: ${res.reclaimableBytes}`
    );
    assert(
      res.fileCount === null,
      '7c. Missing category fileCount is strictly null (never 0)',
      `Got: ${res.fileCount}`
    );
    assert(
      typeof res.failureReason === 'string' && res.failureReason.length > 0,
      '7d. Missing category provides descriptive failureReason',
      `Reason: ${res.failureReason}`
    );
  }

  // 8. Empty readable directory returns 0 bytes and 0 files with scanned status
  {
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deskklean-empty-'));
    try {
      const res = await scanCategory({
        id: 'test-empty',
        name: 'Empty Directory',
        description: 'Testing empty readable directory',
        rawPath: emptyDir,
        strategy: 'fixed',
        defaultEnabled: true,
        adminRequired: false,
        verdict: 'SAFE',
        source: 'https://learn.microsoft.com',
        deletionMethod: 'permanent',
      });

      assert(
        res.status === 'scanned',
        '8a. Readable empty directory reports status: "scanned"'
      );
      assert(
        res.reclaimableBytes === 0,
        '8b. Readable empty directory reports reclaimableBytes: 0 (measured)',
        `Got: ${res.reclaimableBytes}`
      );
      assert(
        res.fileCount === 0,
        '8c. Readable empty directory reports fileCount: 0',
        `Got: ${res.fileCount}`
      );
      assert(
        res.inUseCount === 0,
        '8d. Readable empty directory has inUseCount: 0'
      );
    } finally {
      fs.rmSync(emptyDir, { recursive: true, force: true });
    }
  }

  console.log('\n=== Section 5: Files in Use & Error Handling ===\n');

  // 9. Files in use detection and separate counting
  {
    const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deskklean-locked-test-'));
    const file1 = path.join(testDir, 'readable1.tmp');
    const file2 = path.join(testDir, 'locked.tmp');
    const file3 = path.join(testDir, 'readable2.tmp');

    try {
      fs.writeFileSync(file1, 'Hello readable 1 - 20 bytes'); // 27 bytes
      fs.writeFileSync(file2, 'Locked in-use content');
      fs.writeFileSync(file3, 'Hello readable 2');

      const size1 = fs.statSync(file1).size;
      const size3 = fs.statSync(file3).size;
      const expectedBytes = size1 + size3;

      // Make file2 unreadable/locked to simulate an in-use or inaccessible file
      if (process.platform === 'win32') {
        const { execSync } = require('child_process');
        execSync(`icacls "${file2}" /deny Everyone:(F)`, { stdio: 'ignore' });
      } else {
        fs.chmodSync(file2, 0o000);
      }

      const res = await scanCategory({
        id: 'test-locked-tree',
        name: 'Tree With In-Use File',
        description: 'Testing partial skip handling',
        rawPath: testDir,
        strategy: 'fixed',
        defaultEnabled: true,
        adminRequired: false,
        verdict: 'SAFE',
        source: 'https://learn.microsoft.com',
        deletionMethod: 'permanent',
      });

      assert(
        res.status === 'partial',
        '9a. Category with locked file reports status: "partial"',
        `Status was: ${res.status}`
      );
      assert(
        res.inUseCount === 1,
        '9b. inUseCount is exactly 1 for the locked file',
        `Got: ${res.inUseCount}`
      );
      assert(
        res.fileCount === 2,
        '9c. fileCount is exactly 2 for the readable files',
        `Got: ${res.fileCount}`
      );
      assert(
        res.reclaimableBytes === expectedBytes,
        '9d. reclaimableBytes accurately measures the readable files',
        `Expected ${expectedBytes}, got ${res.reclaimableBytes}`
      );
      assert(
        Array.isArray(res.skippedFiles) && res.skippedFiles.length === 1,
        '9e. skippedFiles array records the locked file',
        `Length: ${res.skippedFiles?.length}`
      );
      assert(
        res.skippedFiles?.[0]?.path === file2,
        '9f. skippedFiles records the exact path of the in-use file'
      );
    } finally {
      if (process.platform === 'win32') {
        try {
          const { execSync } = require('child_process');
          execSync(`icacls "${file2}" /grant Everyone:(F)`, { stdio: 'ignore' });
        } catch {}
      } else {
        try {
          fs.chmodSync(file2, 0o666);
        } catch {}
      }
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  }

  // 10. Glob pattern matching
  {
    const globDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deskklean-glob-'));
    try {
      const match1 = path.join(globDir, 'thumbcache_256.db');
      const match2 = path.join(globDir, 'thumbcache_idx.db');
      const ignore1 = path.join(globDir, 'iconcache_wide.db');
      const ignore2 = path.join(globDir, 'thumbcache_preview.txt');

      fs.writeFileSync(match1, '1234567890'); // 10 bytes
      fs.writeFileSync(match2, '12345');      // 5 bytes
      fs.writeFileSync(ignore1, '999999999999999');
      fs.writeFileSync(ignore2, 'not a db');

      const res = await scanCategory({
        id: 'test-glob',
        name: 'Glob Test Cache',
        description: 'Testing glob pattern matching',
        rawPath: globDir,
        strategy: 'glob',
        globPattern: 'thumbcache_*.db',
        defaultEnabled: true,
        adminRequired: false,
        verdict: 'SAFE',
        source: 'https://learn.microsoft.com',
        deletionMethod: 'permanent',
      });

      assert(
        res.fileCount === 2,
        '10a. Only matching thumbcache_*.db files are counted (2)',
        `Got: ${res.fileCount}`
      );
      assert(
        res.reclaimableBytes === 15,
        '10b. reclaimableBytes matches exactly 10 + 5 = 15 bytes',
        `Got: ${res.reclaimableBytes}`
      );
      assert(
        res.files?.some((f) => f.path === match1),
        '10c. Contains match1'
      );
      assert(
        res.files?.some((f) => f.path === match2),
        '10d. Contains match2'
      );
      assert(
        !res.files?.some((f) => f.path === ignore1 || f.path === ignore2),
        '10e. Correctly ignores non-matching filenames'
      );
    } finally {
      fs.rmSync(globDir, { recursive: true, force: true });
    }
  }

  console.log('\n=== Section 6: End-to-End Scan Aggregation & Degradation ===\n');

  // 11. scanSmartClean end-to-end with real measurement and graceful degradation
  {
    const testDir1 = fs.mkdtempSync(path.join(os.tmpdir(), 'deskklean-cat1-'));
    const testDir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'deskklean-cat2-'));
    const missingDir = path.join(os.tmpdir(), `deskklean-cat3-missing-${Date.now()}`);

    try {
      fs.writeFileSync(path.join(testDir1, 'temp1.tmp'), 'A'.repeat(100)); // 100 bytes
      fs.writeFileSync(path.join(testDir2, 'temp2.tmp'), 'B'.repeat(250)); // 250 bytes

      const mockCategories = [
        {
          id: 'cat-1',
          name: 'Category 1',
          description: '100 byte folder',
          rawPath: testDir1,
          strategy: 'fixed',
          defaultEnabled: true,
          adminRequired: false,
          verdict: 'SAFE',
          source: 'https://learn.microsoft.com',
          deletionMethod: 'permanent',
        },
        {
          id: 'cat-2',
          name: 'Category 2',
          description: '250 byte folder',
          rawPath: testDir2,
          strategy: 'fixed',
          defaultEnabled: true,
          adminRequired: false,
          verdict: 'SAFE',
          source: 'https://learn.microsoft.com',
          deletionMethod: 'permanent',
        },
        {
          id: 'cat-3-failing',
          name: 'Failing Category',
          description: 'Non-existent directory',
          rawPath: missingDir,
          strategy: 'fixed',
          defaultEnabled: true,
          adminRequired: false,
          verdict: 'SAFE',
          source: 'https://learn.microsoft.com',
          deletionMethod: 'permanent',
        },
      ];

      const report = await scanSmartClean(undefined, {
        categories: mockCategories,
      });

      assert(
        report !== null && typeof report === 'object',
        '11a. scanSmartClean returns report object'
      );
      assert(
        typeof report.generatedAt === 'string' && !isNaN(Date.parse(report.generatedAt)),
        '11b. generatedAt is valid ISO 8601 timestamp'
      );
      assert(
        typeof report.scanDurationMs === 'number' && report.scanDurationMs >= 0,
        '11c. scanDurationMs is real measured number >= 0 (never 1420)',
        `Got: ${report.scanDurationMs}`
      );
      assert(
        report.scanDurationMs !== 1420,
        '11d. scanDurationMs is not the old fake 1420 ms'
      );
      assert(
        report.categories.length === 3,
        '11e. Exactly 3 categories reported'
      );
      assert(
        report.categories[2].status === 'failed',
        '11f. Category 3 failed gracefully without aborting the scan'
      );
      assert(
        report.categories[0].status === 'scanned' && report.categories[1].status === 'scanned',
        '11g. Categories 1 and 2 succeeded despite category 3 failure'
      );
      assert(
        report.totalReclaimableBytes === 350,
        '11h. totalReclaimableBytes is exact sum of real measurements (100 + 250 = 350)',
        `Got: ${report.totalReclaimableBytes}`
      );
      assert(
        Array.isArray(report.excluded) && report.excluded.length === EXCLUDED_CATEGORIES.length,
        '11i. Excluded categories always present in report with reasons'
      );
    } finally {
      fs.rmSync(testDir1, { recursive: true, force: true });
      fs.rmSync(testDir2, { recursive: true, force: true });
    }
  }

  console.log('\n========================================');
  console.log(`Total tests: ${passedCount + failedCount}`);
  console.log(`Passed:      ${passedCount}`);
  console.log(`Failed:      ${failedCount}`);
  console.log('========================================\n');

  if (failedCount > 0) {
    process.exit(1);
  } else {
    console.log('ALL PHASE 5 SMARTCLEAN TESTS PASSED!\n');
  }
}

runTests().catch((err) => {
  console.error('Test execution uncaught error:', err);
  process.exit(1);
});
