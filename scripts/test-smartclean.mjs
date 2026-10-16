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
let executeModule;
let frameworkPlanModule;

try {
  categoriesModule = require('../dist/main/system/smartclean/categories.js');
  scanModule = require('../dist/main/system/smartclean/scan.js');
  protectedModule = require('../dist/main/system/framework/protected.js');
  executeModule = require('../dist/main/system/smartclean/execute.js');
  frameworkPlanModule = require('../dist/main/system/framework/plan.js');
} catch {
  const { execSync } = require('child_process');
  execSync('npm run build:main', { cwd: path.resolve(__dirname, '..'), stdio: 'inherit' });
  categoriesModule = require('../dist/main/system/smartclean/categories.js');
  scanModule = require('../dist/main/system/smartclean/scan.js');
  protectedModule = require('../dist/main/system/framework/protected.js');
  executeModule = require('../dist/main/system/smartclean/execute.js');
  frameworkPlanModule = require('../dist/main/system/framework/plan.js');
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
const { createSmartCleanPlan, planSmartClean, executeSmartClean } = executeModule;
const { getOperationPlan } = frameworkPlanModule;

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

  console.log('\n=== Section 7: Phase 6 Plan Conversion & Framework Execution Rails ===\n');

  // 12. Plan conversion from a scan result
  {
    const mockReport = {
      generatedAt: new Date().toISOString(),
      scanDurationMs: 45,
      categories: [
        {
          id: 'user-temp',
          name: 'User Temporary Files',
          path: 'C:\\Users\\Alice\\AppData\\Local\\Temp',
          verdict: 'SAFE',
          source: 'https://learn.microsoft.com',
          reclaimableBytes: 1200,
          fileCount: 2,
          inUseCount: 0,
          status: 'scanned',
          adminRequired: false,
          deletionMethod: 'permanent',
          files: [
            { path: 'C:\\Users\\Alice\\AppData\\Local\\Temp\\file1.tmp', sizeBytes: 800 },
            { path: 'C:\\Users\\Alice\\AppData\\Local\\Temp\\file2.tmp', sizeBytes: 400 },
          ],
        },
        {
          id: 'recent-documents',
          name: 'Recent Documents',
          path: 'C:\\Users\\Alice\\AppData\\Roaming\\Microsoft\\Windows\\Recent',
          verdict: 'SAFE',
          source: 'https://learn.microsoft.com',
          reclaimableBytes: 350,
          fileCount: 1,
          inUseCount: 0,
          status: 'scanned',
          adminRequired: false,
          deletionMethod: 'recycle-bin',
          files: [
            { path: 'C:\\Users\\Alice\\AppData\\Roaming\\Microsoft\\Windows\\Recent\\doc.lnk', sizeBytes: 350 },
          ],
        },
      ],
      excluded: EXCLUDED_CATEGORIES,
      totalReclaimableBytes: 1550,
    };

    const plan = createSmartCleanPlan(mockReport, ['user-temp', 'recent-documents']);

    assert(
      plan !== null && typeof plan === 'object',
      '12a. createSmartCleanPlan returns an OperationPlan object'
    );
    assert(
      typeof plan.id === 'string' && plan.id.startsWith('plan-'),
      '12b. Plan receives stable unique ID prefixed with plan-',
      `Got plan id: ${plan.id}`
    );
    assert(
      plan.module === 'smart-clean',
      '12c. Plan module is "smart-clean"',
      `Got module: ${plan.module}`
    );
    assert(
      getOperationPlan(plan.id) !== undefined,
      '12d. Plan is registered and retrievable from framework store'
    );
    assert(
      plan.actions.length === 3,
      '12e. Plan emits actions for files in scanned categories (2 from user-temp, 1 from recent-documents)',
      `Got ${plan.actions.length} actions`
    );

    // Verify metadata on every action
    for (const action of plan.actions) {
      assert(
        action.metadata && typeof action.metadata.categoryId === 'string',
        `12f. Action "${action.id}" carries categoryId in metadata`,
        `Metadata: ${JSON.stringify(action.metadata)}`
      );
      assert(
        action.metadata.deletionMethod === 'permanent' || action.metadata.deletionMethod === 'recycle-bin',
        `12g. Action "${action.id}" carries valid deletionMethod in metadata`
      );
      assert(
        typeof action.metadata.adminRequired === 'boolean',
        `12h. Action "${action.id}" carries adminRequired flag in metadata`
      );
    }
  }

  // 13. reclaimableBytes equals the scan sum (and never estimated)
  {
    const mockReport = {
      generatedAt: new Date().toISOString(),
      scanDurationMs: 30,
      categories: [
        {
          id: 'user-temp',
          name: 'User Temp',
          path: 'C:\\Users\\Alice\\AppData\\Local\\Temp',
          verdict: 'SAFE',
          source: 'https://learn.microsoft.com',
          reclaimableBytes: 5000,
          fileCount: 1,
          inUseCount: 0,
          status: 'scanned',
          adminRequired: false,
          deletionMethod: 'permanent',
          files: [{ path: 'C:\\Users\\Alice\\AppData\\Local\\Temp\\big.tmp', sizeBytes: 5000 }],
        },
        {
          id: 'system-temp',
          name: 'System Temp',
          path: 'C:\\Windows\\Temp',
          verdict: 'SAFE',
          source: 'https://learn.microsoft.com',
          reclaimableBytes: 3000,
          fileCount: 1,
          inUseCount: 0,
          status: 'scanned',
          adminRequired: true,
          deletionMethod: 'permanent',
          files: [{ path: 'C:\\Windows\\Temp\\sys.tmp', sizeBytes: 3000 }],
        },
        {
          id: 'unselected-cat',
          name: 'Unselected',
          path: 'C:\\Users\\Alice\\AppData\\Local\\D3DSCACHE',
          verdict: 'SAFE',
          source: 'https://learn.microsoft.com',
          reclaimableBytes: 99999,
          fileCount: 1,
          inUseCount: 0,
          status: 'scanned',
          adminRequired: false,
          deletionMethod: 'permanent',
          files: [{ path: 'C:\\Users\\Alice\\AppData\\Local\\D3DSCACHE\\cache.bin', sizeBytes: 99999 }],
        },
      ],
      excluded: EXCLUDED_CATEGORIES,
      totalReclaimableBytes: 107999,
    };

    const plan = createSmartCleanPlan(mockReport, ['user-temp', 'system-temp']);

    assert(
      plan.totalReclaimableBytes === 8000,
      '13a. plan.totalReclaimableBytes equals exact sum of selected categories (5000 + 3000 = 8000)',
      `Got: ${plan.totalReclaimableBytes}`
    );
    assert(
      plan.totalReclaimableBytes !== mockReport.totalReclaimableBytes,
      '13b. Unselected category bytes (99999) are excluded from plan totalReclaimableBytes'
    );

    // Unmeasured category with reclaimableBytes: null
    const unmeasuredReport = {
      generatedAt: new Date().toISOString(),
      scanDurationMs: 20,
      categories: [
        {
          id: 'system-restore',
          name: 'System Restore',
          path: 'vssadmin',
          verdict: 'CONDITIONAL',
          source: 'https://learn.microsoft.com',
          reclaimableBytes: null,
          fileCount: 3,
          inUseCount: 0,
          status: 'scanned',
          adminRequired: true,
          deletionMethod: 'permanent',
          files: [],
        },
      ],
      excluded: EXCLUDED_CATEGORIES,
      totalReclaimableBytes: 0,
    };

    const unmeasuredPlan = createSmartCleanPlan(unmeasuredReport, ['system-restore']);
    assert(
      unmeasuredPlan.totalReclaimableBytes === null,
      '13c. Category with null reclaimableBytes produces null plan total (never guessed as 0)',
      `Got: ${unmeasuredPlan.totalReclaimableBytes}`
    );
  }

  // 14. Reversibility correct per deletion method (decision D-R2-4)
  {
    const mockReport = {
      generatedAt: new Date().toISOString(),
      scanDurationMs: 15,
      categories: [
        {
          id: 'recent-documents',
          name: 'Recent Documents',
          path: 'C:\\Users\\Alice\\AppData\\Roaming\\Microsoft\\Windows\\Recent',
          verdict: 'SAFE',
          source: 'https://learn.microsoft.com',
          reclaimableBytes: 100,
          fileCount: 1,
          inUseCount: 0,
          status: 'scanned',
          adminRequired: false,
          deletionMethod: 'recycle-bin',
          files: [{ path: 'C:\\Users\\Alice\\AppData\\Roaming\\Microsoft\\Windows\\Recent\\a.lnk', sizeBytes: 100 }],
        },
        {
          id: 'jump-lists',
          name: 'Jump Lists',
          path: 'C:\\Users\\Alice\\AppData\\Roaming\\Microsoft\\Windows\\Recent\\AutomaticDestinations',
          verdict: 'SAFE',
          source: 'https://learn.microsoft.com',
          reclaimableBytes: 200,
          fileCount: 1,
          inUseCount: 0,
          status: 'scanned',
          adminRequired: false,
          deletionMethod: 'recycle-bin',
          files: [{ path: 'C:\\Users\\Alice\\AppData\\Roaming\\Microsoft\\Windows\\Recent\\AutomaticDestinations\\b.dest', sizeBytes: 200 }],
        },
        {
          id: 'user-temp',
          name: 'User Temp',
          path: 'C:\\Users\\Alice\\AppData\\Local\\Temp',
          verdict: 'SAFE',
          source: 'https://learn.microsoft.com',
          reclaimableBytes: 300,
          fileCount: 1,
          inUseCount: 0,
          status: 'scanned',
          adminRequired: false,
          deletionMethod: 'permanent',
          files: [{ path: 'C:\\Users\\Alice\\AppData\\Local\\Temp\\c.tmp', sizeBytes: 300 }],
        },
        {
          id: 'windows-old',
          name: 'Windows.old',
          path: 'C:\\Windows.old',
          verdict: 'CONDITIONAL',
          source: 'https://learn.microsoft.com',
          reclaimableBytes: 4000,
          fileCount: 1,
          inUseCount: 0,
          status: 'scanned',
          adminRequired: true,
          deletionMethod: 'permanent',
          consequence: 'Permanent loss of rollback to previous Windows version.',
          files: [{ path: 'C:\\Windows.old\\old.sys', sizeBytes: 4000 }],
        },
        {
          id: 'system-restore',
          name: 'System Restore Points',
          path: 'vssadmin',
          verdict: 'CONDITIONAL',
          source: 'https://learn.microsoft.com',
          reclaimableBytes: null,
          fileCount: 2,
          inUseCount: 0,
          status: 'scanned',
          adminRequired: true,
          deletionMethod: 'permanent',
          consequence: 'Permanent loss of all restore points.',
          files: [],
        },
      ],
      excluded: EXCLUDED_CATEGORIES,
      totalReclaimableBytes: 4600,
    };

    // 14a. Reversible plan for user data (Recycle Bin)
    const revPlan = createSmartCleanPlan(mockReport, ['recent-documents', 'jump-lists']);
    assert(
      revPlan.reversibility === 'reversible',
      '14a. User data categories deleted to Recycle Bin produce reversible plan',
      `Got: ${revPlan.reversibility}`
    );
    assert(
      revPlan.irreversibilityReason === undefined,
      '14b. Reversible plan has no irreversibilityReason'
    );

    // 14c. Irreversible plan for permanent system junk
    const irrevPlan = createSmartCleanPlan(mockReport, ['user-temp']);
    assert(
      irrevPlan.reversibility === 'irreversible',
      '14c. Permanent delete category produces irreversible plan',
      `Got: ${irrevPlan.reversibility}`
    );
    assert(
      typeof irrevPlan.irreversibilityReason === 'string' && irrevPlan.irreversibilityReason.length > 0,
      '14d. Irreversible plan has non-empty irreversibilityReason',
      `Reason: ${irrevPlan.irreversibilityReason}`
    );

    // 14e. Windows.old consequence stated in reason
    const winOldPlan = createSmartCleanPlan(mockReport, ['windows-old']);
    assert(
      winOldPlan.reversibility === 'irreversible',
      '14e. Windows.old deletion is irreversible'
    );
    assert(
      typeof winOldPlan.irreversibilityReason === 'string' &&
        winOldPlan.irreversibilityReason.toLowerCase().includes('windows.old') &&
        winOldPlan.irreversibilityReason.toLowerCase().includes('rollback'),
      '14f. Windows.old plan explicitly states rollback loss consequence in reason',
      `Reason: ${winOldPlan.irreversibilityReason}`
    );

    // 14g. System Restore points consequence stated in reason
    const sysRestorePlan = createSmartCleanPlan(mockReport, ['system-restore']);
    assert(
      sysRestorePlan.reversibility === 'irreversible',
      '14g. System restore point deletion is irreversible'
    );
    assert(
      typeof sysRestorePlan.irreversibilityReason === 'string' &&
        sysRestorePlan.irreversibilityReason.toLowerCase().includes('restore') &&
        sysRestorePlan.irreversibilityReason.toLowerCase().includes('vss'),
      '14h. System Restore plan explicitly states restore points loss via VSS in reason',
      `Reason: ${sysRestorePlan.irreversibilityReason}`
    );
  }

  // 15. A protected path refused before entering the plan
  {
    const mockReportWithProtected = {
      generatedAt: new Date().toISOString(),
      scanDurationMs: 25,
      categories: [
        {
          id: 'legit-temp',
          name: 'Legit Temp',
          path: 'C:\\Windows\\Temp',
          verdict: 'SAFE',
          source: 'https://learn.microsoft.com',
          reclaimableBytes: 100,
          fileCount: 1,
          inUseCount: 0,
          status: 'scanned',
          adminRequired: true,
          deletionMethod: 'permanent',
          files: [{ path: 'C:\\Windows\\Temp\\junk.tmp', sizeBytes: 100 }],
        },
        {
          id: 'malicious-sys32',
          name: 'Protected System32 Attempt',
          path: 'C:\\Windows\\System32',
          verdict: 'SAFE',
          source: 'https://learn.microsoft.com',
          reclaimableBytes: 999999,
          fileCount: 1,
          inUseCount: 0,
          status: 'scanned',
          adminRequired: true,
          deletionMethod: 'permanent',
          files: [{ path: 'C:\\Windows\\System32\\cmd.exe', sizeBytes: 999999 }],
        },
        {
          id: 'malicious-sysroot',
          name: 'Protected Root Attempt',
          path: 'C:\\Windows',
          verdict: 'SAFE',
          source: 'https://learn.microsoft.com',
          reclaimableBytes: 12345,
          fileCount: 1,
          inUseCount: 0,
          status: 'scanned',
          adminRequired: true,
          deletionMethod: 'permanent',
          files: [],
        },
      ],
      excluded: EXCLUDED_CATEGORIES,
      totalReclaimableBytes: 1012444,
    };

    const plan = createSmartCleanPlan(mockReportWithProtected, [
      'legit-temp',
      'malicious-sys32',
      'malicious-sysroot',
    ]);

    // Ensure protected paths never enter actions
    const hasSys32Action = plan.actions.some((a) => a.target.toLowerCase().includes('system32'));
    const hasSysRootAction = plan.actions.some(
      (a) => a.target.toLowerCase() === 'c:\\windows' || a.target.toLowerCase() === 'c:/windows'
    );

    assert(
      !hasSys32Action,
      '15a. Protected System32 path is NOT included in plan.actions'
    );
    assert(
      !hasSysRootAction,
      '15b. Protected SystemRoot path is NOT included in plan.actions'
    );
    assert(
      plan.blocked.length >= 2,
      '15c. Protected targets are recorded in plan.blocked array',
      `Blocked count: ${plan.blocked.length}`
    );

    const blockedTargets = plan.blocked.map((b) => b.target.toLowerCase());
    assert(
      blockedTargets.some((t) => t.includes('system32')),
      '15d. System32 is recorded in plan.blocked'
    );
    assert(
      blockedTargets.some((t) => t.includes('windows')),
      '15e. Windows root is recorded in plan.blocked'
    );

    const hasReason = plan.blocked.every((b) => typeof b.reason === 'string' && b.reason.length > 0);
    assert(
      hasReason,
      '15f. Every blocked action provides an explicit refusal reason'
    );

    // Legit subpath is included
    const hasLegit = plan.actions.some((a) => a.target.toLowerCase().includes('junk.tmp'));
    assert(
      hasLegit,
      '15g. Allowed safe subpath (C:\\Windows\\Temp\\junk.tmp) is permitted in plan.actions'
    );
  }

  // 16. Unelevated run with an admin category refused
  {
    const mockReport = {
      generatedAt: new Date().toISOString(),
      scanDurationMs: 20,
      categories: [
        {
          id: 'user-temp',
          name: 'User Temp (Non-Admin)',
          path: 'C:\\Users\\Alice\\AppData\\Local\\Temp',
          verdict: 'SAFE',
          source: 'https://learn.microsoft.com',
          reclaimableBytes: 500,
          fileCount: 1,
          inUseCount: 0,
          status: 'scanned',
          adminRequired: false,
          deletionMethod: 'permanent',
          files: [{ path: 'C:\\Users\\Alice\\AppData\\Local\\Temp\\test.tmp', sizeBytes: 500 }],
        },
        {
          id: 'system-temp',
          name: 'System Temp (Admin Required)',
          path: 'C:\\Windows\\Temp',
          verdict: 'SAFE',
          source: 'https://learn.microsoft.com',
          reclaimableBytes: 1500,
          fileCount: 1,
          inUseCount: 0,
          status: 'scanned',
          adminRequired: true,
          deletionMethod: 'permanent',
          files: [{ path: 'C:\\Windows\\Temp\\admin.tmp', sizeBytes: 1500 }],
        },
      ],
      excluded: EXCLUDED_CATEGORIES,
      totalReclaimableBytes: 2000,
    };

    // 16a. Plan requires elevation when admin category is included
    const adminPlan = createSmartCleanPlan(mockReport, ['user-temp', 'system-temp']);
    assert(
      adminPlan.requiresElevation === true,
      '16a. Plan with admin-required category has requiresElevation: true'
    );

    // 16b. Plan does not require elevation when only non-admin categories are included
    const userOnlyPlan = createSmartCleanPlan(mockReport, ['user-temp']);
    assert(
      userOnlyPlan.requiresElevation === false,
      '16b. Plan with only non-admin categories has requiresElevation: false'
    );

    // 16c. executeSmartClean refuses to run unelevated when admin category is present
    const unelevatedExecutionResult = await executeSmartClean(
      mockReport,
      ['user-temp', 'system-temp'],
      {
        isElevatedFn: async () => false, // Simulate unelevated process
      }
    );

    assert(
      unelevatedExecutionResult.success === false,
      '16c. Unelevated run with admin category returns success: false'
    );
    assert(
      unelevatedExecutionResult.completed === 0,
      '16d. Unelevated run completes 0 actions (refuses before touching anything)'
    );
    assert(
      Array.isArray(unelevatedExecutionResult.failures) &&
        unelevatedExecutionResult.failures.length > 0 &&
        unelevatedExecutionResult.failures[0].error.toLowerCase().includes('administrator'),
      '16e. Unelevated run reports Administrator rights requirement in failures array',
      `Failures: ${JSON.stringify(unelevatedExecutionResult.failures)}`
    );
    assert(
      typeof unelevatedExecutionResult.message === 'string' &&
        unelevatedExecutionResult.message.toLowerCase().includes('administrator'),
      '16f. Unelevated run message states Administrator rights required',
      `Message: ${unelevatedExecutionResult.message}`
    );
  }

  // 17. Empty-category safety guardrail (0 files) and exemptions
  {
    const mockReport = {
      generatedAt: new Date().toISOString(),
      scanDurationMs: 25,
      categories: [
        {
          id: 'system-temp',
          name: 'System Temp',
          path: 'C:\\Windows\\Temp',
          verdict: 'SAFE',
          source: 'https://learn.microsoft.com',
          reclaimableBytes: 0,
          fileCount: 0,
          inUseCount: 0,
          status: 'scanned',
          adminRequired: true,
          deletionMethod: 'permanent',
          files: [],
        },
        {
          id: 'windows-old',
          name: 'Windows.old',
          path: 'C:\\Windows.old',
          verdict: 'CONDITIONAL',
          source: 'https://learn.microsoft.com',
          reclaimableBytes: 0,
          fileCount: 0,
          inUseCount: 0,
          status: 'scanned',
          adminRequired: true,
          deletionMethod: 'permanent',
          consequence: 'Permanent loss of rollback to previous Windows version.',
          files: [],
        },
        {
          id: 'memory-dump',
          name: 'Kernel Memory Dump',
          path: 'C:\\Windows\\MEMORY.DMP',
          verdict: 'SAFE',
          source: 'https://learn.microsoft.com',
          reclaimableBytes: 0,
          fileCount: 0,
          inUseCount: 0,
          status: 'scanned',
          adminRequired: true,
          deletionMethod: 'permanent',
          files: [],
        },
      ],
      excluded: EXCLUDED_CATEGORIES,
      totalReclaimableBytes: 0,
    };

    // 17a. A normal directory category with empty files array produces ZERO actions targeting that path
    const emptyTempPlan = createSmartCleanPlan(mockReport, ['system-temp']);
    const tempActions = emptyTempPlan.actions.filter(
      (a) => a.target.toLowerCase() === 'c:\\windows\\temp'
    );
    assert(
      tempActions.length === 0,
      '17a. Category whose files array is empty ([]) and whose path is a normal directory (C:\\Windows\\Temp) produces ZERO actions targeting that path',
      `Expected 0 actions targeting C:\\Windows\\Temp, got ${tempActions.length}`
    );
    assert(
      emptyTempPlan.actions.length === 0,
      '17b. Empty normal directory category emits 0 actions total (never deletes folder itself)',
      `Expected 0 actions, got ${emptyTempPlan.actions.length}`
    );

    // 17c. The windows-old category still produces a delete-tree even when its files array is empty
    const winOldPlan = createSmartCleanPlan(mockReport, ['windows-old']);
    const winOldAction = winOldPlan.actions.find((a) => a.id === 'windows-old');
    assert(
      winOldAction !== undefined,
      '17c. The windows-old category still produces an action when its files array is empty',
      `Expected action for windows-old, got ${winOldPlan.actions.map((a) => a.id).join(', ')}`
    );
    assert(
      winOldAction?.kind === 'delete-tree',
      '17d. The windows-old action kind is delete-tree',
      `Expected kind "delete-tree", got "${winOldAction?.kind}"`
    );
    assert(
      winOldAction?.target.toLowerCase() === 'c:\\windows.old',
      '17e. The windows-old action targets C:\\Windows.old directory',
      `Expected target C:\\Windows.old, got "${winOldAction?.target}"`
    );

    // 17f. A single-file category (path ending in .dmp) still produces a delete-file even when its files array is empty
    const memDumpPlan = createSmartCleanPlan(mockReport, ['memory-dump']);
    const memDumpAction = memDumpPlan.actions.find((a) => a.id === 'memory-dump');
    assert(
      memDumpAction !== undefined,
      '17f. Single-file category (path ending in .dmp) still produces an action when its files array is empty',
      `Expected action for memory-dump, got ${memDumpPlan.actions.map((a) => a.id).join(', ')}`
    );
    assert(
      memDumpAction?.kind === 'delete-file',
      '17g. Single-file category action kind is delete-file',
      `Expected kind "delete-file", got "${memDumpAction?.kind}"`
    );
    assert(
      memDumpAction?.target.toLowerCase() === 'c:\\windows\\memory.dmp',
      '17h. Single-file category action targets C:\\Windows\\MEMORY.DMP file',
      `Expected target C:\\Windows\\MEMORY.DMP, got "${memDumpAction?.target}"`
    );

    // 17i. Combined plan verifies guardrail and exemptions together
    const combinedPlan = createSmartCleanPlan(mockReport, [
      'system-temp',
      'windows-old',
      'memory-dump',
    ]);
    const combinedTempActions = combinedPlan.actions.filter(
      (a) => a.target.toLowerCase() === 'c:\\windows\\temp'
    );
    assert(
      combinedTempActions.length === 0,
      '17i. Combined plan produces ZERO actions targeting empty directory C:\\Windows\\Temp',
      `Expected 0 actions targeting C:\\Windows\\Temp in combined plan, got ${combinedTempActions.length}`
    );
    assert(
      combinedPlan.actions.length === 2,
      '17j. Combined plan contains exactly 2 actions (windows-old delete-tree and memory-dump delete-file)',
      `Expected 2 actions, got ${combinedPlan.actions.length}`
    );
  }

  console.log('\n========================================');
  console.log(`Total tests: ${passedCount + failedCount}`);
  console.log(`Passed:      ${passedCount}`);
  console.log(`Failed:      ${failedCount}`);
  console.log('========================================\n');

  if (failedCount > 0) {
    process.exit(1);
  } else {
    console.log('ALL PHASE 5 & 6 SMARTCLEAN TESTS PASSED!\n');
  }
}

runTests().catch((err) => {
  console.error('Test execution uncaught error:', err);
  process.exit(1);
});
