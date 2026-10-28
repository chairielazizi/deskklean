// scripts/test-leftovers.mjs
// Pure-logic unit tests for Phase 19 AppRemover Leftovers Detection.
// Covers all 14 cases from docs/PHASE-19-LEFTOVERS.md §6.

import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

let leftoversModule;
let protectedModule;

try {
  leftoversModule = require('../dist/main/system/leftovers.js');
  protectedModule = require('../dist/main/system/framework/protected.js');
} catch {
  const { execSync } = require('child_process');
  execSync('npm run build:main', { cwd: path.resolve(__dirname, '..'), stdio: 'inherit' });
  leftoversModule = require('../dist/main/system/leftovers.js');
  protectedModule = require('../dist/main/system/framework/protected.js');
}

const {
  normalizeAppToken,
  buildLeftoverCandidates,
  filterLeftoverCandidates,
  scanLeftovers,
  createLeftoverCleanupPlan,
  getEnvRoots,
} = leftoversModule;

const { validatePath } = protectedModule;

let testsPassed = 0;
let testsFailed = 0;

function assert(condition, message, details = '') {
  if (condition) {
    console.log(`[PASS] ${message}`);
    testsPassed++;
  } else {
    console.error(`[FAIL] ${message}`);
    if (details) console.error(`       ${details}`);
    testsFailed++;
  }
}

console.log('\n=== Phase 19: AppRemover Leftover Detection Pure-Logic Tests (Cases 1..14) ===\n');

const testEnv = {
  USERPROFILE: 'C:\\Users\\TestUser',
  LOCALAPPDATA: 'C:\\Users\\TestUser\\AppData\\Local',
  APPDATA: 'C:\\Users\\TestUser\\AppData\\Roaming',
  ProgramData: 'C:\\ProgramData',
  ProgramFiles: 'C:\\Program Files',
  'ProgramFiles(x86)': 'C:\\Program Files (x86)',
};

// Case 1: normalizeAppToken strips (x86), version tokens, and company suffixes
{
  const t1 = normalizeAppToken('7-Zip (x86)');
  const t2 = normalizeAppToken('Acme Tool, Inc.');
  const t3 = normalizeAppToken('Visual Studio Code 1.85.2');
  const t4 = normalizeAppToken('Contoso Sdn Bhd');
  const t5 = normalizeAppToken('Widget Corp 2.0');
  const t6 = normalizeAppToken('SuperApp LLC v3.1-beta');
  const t7 = normalizeAppToken('Mozilla Firefox 115.0esr (64-bit)');

  assert(
    t1 === '7-zip' &&
      t2 === 'acme tool' &&
      t3 === 'visual studio code' &&
      t4 === 'contoso' &&
      t5 === 'widget' &&
      t6 === 'superapp' &&
      t7 === 'mozilla firefox',
    'Case 1: normalizeAppToken strips (x86), version tokens, and company suffixes',
    `Results: t1=${t1}, t2=${t2}, t3=${t3}, t4=${t4}, t5=${t5}, t6=${t6}, t7=${t7}`
  );
}

// Case 2: Candidate generation covers install dir + the five env roots + three registry roots
{
  const testApp = {
    id: 'acme-app',
    name: 'Acme Tool',
    publisher: 'Acme',
    version: '1.0.0',
    installDate: '2024-01-01',
    sizeBytes: 1048576,
    installLocation: 'C:\\Games\\Acme Tool',
    uninstallString: 'C:\\Games\\Acme Tool\\uninstall.exe',
    quietUninstallString: null,
    productCode: null,
    isMsi: false,
    isStoreApp: false,
    uninstallMethod: 'uninstall-string',
    leftoversDetected: null,
  };

  const candidates = buildLeftoverCandidates(testApp, testEnv);
  const paths = candidates.map((c) => c.path.toLowerCase().replace(/\\/g, '/'));

  const hasInstallDir = paths.includes('c:/games/acme tool');
  const hasLocalAppData = paths.includes('c:/users/testuser/appdata/local/acme tool');
  const hasAppData = paths.includes('c:/users/testuser/appdata/roaming/acme tool');
  const hasProgramData = paths.includes('c:/programdata/acme tool');
  const hasLocalPrograms = paths.includes('c:/users/testuser/appdata/local/programs/acme tool');
  const hasProgramFiles = paths.includes('c:/program files/acme tool');
  const hasHkcu = paths.includes('hkcu/software/acme tool');
  const hasHklm = paths.includes('hklm/software/acme tool');
  const hasWow64 = paths.includes('hklm/software/wow6432node/acme tool');

  assert(
    hasInstallDir &&
      hasLocalAppData &&
      hasAppData &&
      hasProgramData &&
      hasLocalPrograms &&
      hasProgramFiles &&
      hasHkcu &&
      hasHklm &&
      hasWow64,
    'Case 2: Candidate generation covers install dir + the five env roots + three registry roots',
    `Missing targets: installDir=${hasInstallDir}, local=${hasLocalAppData}, roaming=${hasAppData}, programdata=${hasProgramData}, programs=${hasLocalPrograms}, programFiles=${hasProgramFiles}, hkcu=${hasHkcu}, hklm=${hasHklm}, wow64=${hasWow64}`
  );
}

// Case 3: Protected path candidate is dropped
{
  const protectedCandidates = [
    {
      id: 'p1',
      kind: 'directory',
      path: 'C:\\Windows\\System32\\Acme',
      sizeBytes: null,
      confidence: 'high',
      reason: 'Remnant',
      selectableByDefault: true,
    },
    {
      id: 'p2',
      kind: 'directory',
      path: 'C:\\Windows\\Acme',
      sizeBytes: null,
      confidence: 'high',
      reason: 'Remnant',
      selectableByDefault: true,
    },
    {
      id: 'p3',
      kind: 'directory',
      path: 'C:\\System Volume Information\\Acme',
      sizeBytes: null,
      confidence: 'high',
      reason: 'Remnant',
      selectableByDefault: true,
    },
  ];

  const filtered = filterLeftoverCandidates(protectedCandidates, [], { env: testEnv });
  assert(
    filtered.length === 0,
    'Case 3: Protected path candidate is dropped',
    `Expected 0 surviving candidates, got ${filtered.length}: ${JSON.stringify(filtered)}`
  );
}

// Case 4: Root itself (%APPDATA%) is never a candidate
{
  const roots = [
    {
      id: 'r1',
      kind: 'directory',
      path: 'C:\\Users\\TestUser\\AppData\\Roaming',
      sizeBytes: null,
      confidence: 'high',
      reason: 'Root',
      selectableByDefault: true,
    },
    {
      id: 'r2',
      kind: 'directory',
      path: 'C:\\Users\\TestUser\\AppData\\Local',
      sizeBytes: null,
      confidence: 'high',
      reason: 'Root',
      selectableByDefault: true,
    },
    {
      id: 'r3',
      kind: 'directory',
      path: 'C:\\ProgramData',
      sizeBytes: null,
      confidence: 'high',
      reason: 'Root',
      selectableByDefault: true,
    },
    {
      id: 'r4',
      kind: 'registry-key',
      path: 'HKCU\\Software',
      sizeBytes: null,
      confidence: 'high',
      reason: 'Root',
      selectableByDefault: true,
    },
  ];

  const filtered = filterLeftoverCandidates(roots, [], { env: testEnv });
  assert(
    filtered.length === 0,
    'Case 4: Root itself (%APPDATA%, %LOCALAPPDATA%, %PROGRAMDATA%, Software) is never a candidate',
    `Expected 0 roots surviving, got ${filtered.length}`
  );
}

// Case 5: Candidate owned by another installed app is dropped, with a reason
{
  const installedApps = [
    {
      id: 'acme-suite',
      name: 'Acme Suite',
      publisher: 'Acme',
      version: '2.0.0',
      installDate: '2024-01-01',
      sizeBytes: 2000000,
      installLocation: 'C:\\Program Files\\Acme Suite',
      uninstallString: null,
      quietUninstallString: null,
      productCode: null,
      isMsi: false,
      isStoreApp: false,
      uninstallMethod: 'uninstall-string',
      leftoversDetected: null,
    },
  ];

  const candidates = [
    {
      id: 'c1',
      kind: 'directory',
      path: 'C:\\Program Files\\Acme Suite',
      sizeBytes: null,
      confidence: 'high',
      reason: 'Install dir',
      selectableByDefault: true,
    },
    {
      id: 'c2',
      kind: 'directory',
      path: 'C:\\Program Files\\Acme Suite\\ToolData',
      sizeBytes: null,
      confidence: 'high',
      reason: 'Subdir',
      selectableByDefault: true,
    },
    {
      id: 'c3',
      kind: 'directory',
      path: 'C:\\Users\\TestUser\\AppData\\Local\\Acme Suite',
      sizeBytes: null,
      confidence: 'high',
      reason: 'AppData',
      selectableByDefault: true,
    },
    {
      id: 'c4',
      kind: 'directory',
      path: 'C:\\Users\\TestUser\\AppData\\Local\\Acme Isolated Tool',
      sizeBytes: null,
      confidence: 'high',
      reason: 'Legitimate leftover',
      selectableByDefault: true,
    },
  ];

  const filtered = filterLeftoverCandidates(candidates, installedApps, {
    env: testEnv,
    currentAppId: 'acme-tool',
  });

  const remainingPaths = filtered.map((c) => c.path);
  assert(
    filtered.length === 1 && remainingPaths[0] === 'C:\\Users\\TestUser\\AppData\\Local\\Acme Isolated Tool',
    'Case 5: Candidate owned by another installed app is dropped, with a reason',
    `Expected only c4, got ${filtered.length}: ${JSON.stringify(remainingPaths)}`
  );
}

// Case 6: %LOCALAPPDATA%\Temp and the Microsoft roots are dropped
{
  const sharedDirCandidates = [
    {
      id: 's1',
      kind: 'directory',
      path: 'C:\\Users\\TestUser\\AppData\\Local\\Temp\\Acme',
      sizeBytes: null,
      confidence: 'high',
      reason: 'Temp dir',
      selectableByDefault: true,
    },
    {
      id: 's2',
      kind: 'directory',
      path: 'C:\\Users\\TestUser\\AppData\\Local\\Microsoft\\Acme',
      sizeBytes: null,
      confidence: 'high',
      reason: 'Microsoft local root',
      selectableByDefault: true,
    },
    {
      id: 's3',
      kind: 'directory',
      path: 'C:\\Users\\TestUser\\AppData\\Roaming\\Microsoft\\Acme',
      sizeBytes: null,
      confidence: 'high',
      reason: 'Microsoft roaming root',
      selectableByDefault: true,
    },
    {
      id: 's4',
      kind: 'directory',
      path: 'C:\\ProgramData\\Microsoft\\Acme',
      sizeBytes: null,
      confidence: 'high',
      reason: 'Microsoft ProgramData root',
      selectableByDefault: true,
    },
    {
      id: 's5',
      kind: 'directory',
      path: 'C:\\Users\\TestUser\\AppData\\Local\\Packages\\Microsoft.WindowsCamera_8wekyb3d8bbwe',
      sizeBytes: null,
      confidence: 'high',
      reason: 'System package',
      selectableByDefault: true,
    },
  ];

  const filtered = filterLeftoverCandidates(sharedDirCandidates, [], { env: testEnv });
  assert(
    filtered.length === 0,
    'Case 6: %LOCALAPPDATA%\\Temp and the Microsoft roots are dropped',
    `Expected 0 surviving shared dir candidates, got ${filtered.length}`
  );
}

// Case 7: Name shorter than 3 chars produces zero candidates
{
  const shortApp = {
    id: 'short-app',
    name: '7z',
    publisher: '',
    version: '1.0',
    installDate: '',
    sizeBytes: null,
    installLocation: 'C:\\Program Files\\7-Zip',
    uninstallString: null,
    quietUninstallString: null,
    productCode: null,
    isMsi: false,
    isStoreApp: false,
    uninstallMethod: 'unavailable',
    leftoversDetected: null,
  };

  const shortApp2 = {
    ...shortApp,
    name: 'Go',
  };

  const cands1 = buildLeftoverCandidates(shortApp, testEnv);
  const cands2 = buildLeftoverCandidates(shortApp2, testEnv);

  assert(
    cands1.length === 0 && cands2.length === 0,
    'Case 7: Name shorter than 3 chars produces zero candidates',
    `Expected 0 candidates, got cands1=${cands1.length}, cands2=${cands2.length}`
  );
}

// Case 8: Exact match → high + selectableByDefault: true; contains match → medium + false
{
  const app = {
    id: 'app-acme',
    name: 'Acme',
    publisher: 'Acme Corp',
    version: '1.0',
    installDate: '',
    sizeBytes: null,
    installLocation: '',
    uninstallString: null,
    quietUninstallString: null,
    productCode: null,
    isMsi: false,
    isStoreApp: false,
    uninstallMethod: 'unavailable',
    leftoversDetected: null,
  };

  const existingEntries = [
    'C:\\Users\\TestUser\\AppData\\Local\\Acme',
    'C:\\Users\\TestUser\\AppData\\Local\\AcmePlugin',
  ];

  const candidates = buildLeftoverCandidates(app, testEnv, { existingEntries });
  const exact = candidates.find(
    (c) => c.path.toLowerCase().replace(/\\/g, '/') === 'c:/users/testuser/appdata/local/acme'
  );
  const substring = candidates.find(
    (c) => c.path.toLowerCase().replace(/\\/g, '/') === 'c:/users/testuser/appdata/local/acmeplugin'
  );

  assert(
    exact &&
      exact.confidence === 'high' &&
      exact.selectableByDefault === true &&
      substring &&
      substring.confidence === 'medium' &&
      substring.selectableByDefault === false,
    'Case 8: Exact match → high + selectableByDefault: true; contains match → medium + false',
    `Exact: conf=${exact?.confidence}, select=${exact?.selectableByDefault}; Substring: conf=${substring?.confidence}, select=${substring?.selectableByDefault}`
  );
}

// Case 9: Scan failure → scanned: false, detectedCount: null, failureReason set (never 0)
await (async () => {
  const app = {
    id: 'app-fail',
    name: 'FailApp',
    publisher: '',
    version: '1.0',
    installDate: '',
    sizeBytes: null,
    installLocation: '',
    uninstallString: null,
    quietUninstallString: null,
    productCode: null,
    isMsi: false,
    isStoreApp: false,
    uninstallMethod: 'unavailable',
    leftoversDetected: null,
  };

  const result = await scanLeftovers(app, { forceFailure: true });

  assert(
    result.scanned === false &&
      result.detectedCount === null &&
      result.totalBytes === null &&
      typeof result.failureReason === 'string' &&
      result.failureReason.length > 0 &&
      result.candidates.length === 0,
    'Case 9: Scan failure → scanned: false, detectedCount: null, failureReason set (never 0)',
    `Result: scanned=${result.scanned}, detectedCount=${result.detectedCount}, reason=${result.failureReason}`
  );
})();

// Case 10: leftoversDetected stays null when no scan ran
{
  const app = {
    id: 'app-unscanned',
    name: 'UnscannedApp',
    publisher: '',
    version: '1.0',
    installDate: '',
    sizeBytes: null,
    installLocation: '',
    uninstallString: null,
    quietUninstallString: null,
    productCode: null,
    isMsi: false,
    isStoreApp: false,
    uninstallMethod: 'unavailable',
    leftoversDetected: null,
  };

  assert(
    app.leftoversDetected === null,
    'Case 10: leftoversDetected stays null when no scan ran',
    `Expected null, got ${app.leftoversDetected}`
  );
}

// Case 11: Cleanup plan: files carry Recycle Bin metadata; registry keys carry a .reg backup
{
  const scanResult = {
    appId: 'acme-app',
    appName: 'Acme Tool',
    scanned: true,
    failureReason: null,
    candidates: [
      {
        id: 'c-file',
        kind: 'file',
        path: 'C:\\Users\\TestUser\\AppData\\Local\\Acme Tool\\config.ini',
        sizeBytes: 1024,
        confidence: 'high',
        reason: 'Config file remnant',
        selectableByDefault: true,
      },
      {
        id: 'c-dir',
        kind: 'directory',
        path: 'C:\\Users\\TestUser\\AppData\\Local\\Acme Tool',
        sizeBytes: 4096,
        confidence: 'high',
        reason: 'Directory remnant',
        selectableByDefault: true,
      },
      {
        id: 'c-reg',
        kind: 'registry-key',
        path: 'HKCU\\Software\\Acme Tool',
        sizeBytes: null,
        confidence: 'high',
        reason: 'Registry subkey remnant',
        selectableByDefault: true,
      },
    ],
    detectedCount: 3,
    totalBytes: 5120,
  };

  const plan = createLeftoverCleanupPlan(scanResult, ['c-file', 'c-dir', 'c-reg']);

  const fileAction = plan.actions.find((a) => a.id === 'clean-c-file');
  const dirAction = plan.actions.find((a) => a.id === 'clean-c-dir');
  const regAction = plan.actions.find((a) => a.id === 'clean-c-reg');

  assert(
    fileAction &&
      fileAction.kind === 'delete-file' &&
      fileAction.metadata?.deletionMethod === 'recycle-bin' &&
      dirAction &&
      dirAction.kind === 'delete-tree' &&
      dirAction.metadata?.deletionMethod === 'recycle-bin' &&
      regAction &&
      regAction.kind === 'registry-key' &&
      regAction.metadata?.backupReg === true &&
      plan.reversibility === 'reversible',
    'Case 11: Cleanup plan: files carry Recycle Bin metadata; registry keys carry a .reg backup',
    `fileAction meta=${JSON.stringify(fileAction?.metadata)}, regAction meta=${JSON.stringify(regAction?.metadata)}, reversibility=${plan.reversibility}`
  );
}

// Case 12: Cleanup plan refuses a candidate id absent from the fresh scan
{
  const scanResult = {
    appId: 'acme-app',
    appName: 'Acme Tool',
    scanned: true,
    failureReason: null,
    candidates: [
      {
        id: 'c1',
        kind: 'directory',
        path: 'C:\\Users\\TestUser\\AppData\\Local\\Acme Tool',
        sizeBytes: 4096,
        confidence: 'high',
        reason: 'Directory remnant',
        selectableByDefault: true,
      },
    ],
    detectedCount: 1,
    totalBytes: 4096,
  };

  let threw = false;
  try {
    createLeftoverCleanupPlan(scanResult, ['non-existent-candidate-id']);
  } catch (err) {
    threw = true;
  }

  assert(
    threw,
    'Case 12: Cleanup plan refuses a candidate id absent from the fresh scan',
    `Expected exception to be thrown for absent candidate ID`
  );
}

// Case 13: Empty selection is refused with a reason
{
  const scanResult = {
    appId: 'acme-app',
    appName: 'Acme Tool',
    scanned: true,
    failureReason: null,
    candidates: [
      {
        id: 'c1',
        kind: 'directory',
        path: 'C:\\Users\\TestUser\\AppData\\Local\\Acme Tool',
        sizeBytes: 4096,
        confidence: 'high',
        reason: 'Directory remnant',
        selectableByDefault: true,
      },
    ],
    detectedCount: 1,
    totalBytes: 4096,
  };

  let threw = false;
  let errorMsg = '';
  try {
    createLeftoverCleanupPlan(scanResult, []);
  } catch (err) {
    threw = true;
    errorMsg = err instanceof Error ? err.message : String(err);
  }

  assert(
    threw && errorMsg.includes('selected'),
    'Case 13: Empty selection is refused with a reason',
    `threw=${threw}, message=${errorMsg}`
  );
}

// Case 14: Unmeasured candidate keeps sizeBytes: null and is excluded from totalBytes sum
await (async () => {
  const testApp = {
    id: 'acme-measured',
    name: 'Acme Tool',
    publisher: '',
    version: '1.0',
    installDate: '',
    sizeBytes: null,
    installLocation: '',
    uninstallString: null,
    quietUninstallString: null,
    productCode: null,
    isMsi: false,
    isStoreApp: false,
    uninstallMethod: 'unavailable',
    leftoversDetected: null,
  };

  // Mock runners: one dir with measured 1024 bytes, one registry key with null sizeBytes
  const mockStatFn = async (p) => {
    const norm = p.replace(/\\/g, '/').toLowerCase();
    if (norm.includes('local/acme tool')) {
      return { isDirectory: () => true, isFile: () => false, size: 0 };
    }
    return null;
  };
  const mockMeasureDirSizeFn = async (p) => {
    const norm = p.replace(/\\/g, '/').toLowerCase();
    if (norm.includes('local/acme tool')) return 2048;
    return null;
  };
  const mockKeyExistsFn = async (hive, keyPath) => {
    return hive === 'HKCU' && keyPath.toLowerCase().includes('acme tool');
  };

  const result = await scanLeftovers(testApp, {
    env: testEnv,
    statFn: mockStatFn,
    measureDirSizeFn: mockMeasureDirSizeFn,
    keyExistsFn: mockKeyExistsFn,
  });

  const regCandidate = result.candidates.find((c) => c.kind === 'registry-key');
  const dirCandidate = result.candidates.find((c) => c.kind === 'directory');

  assert(
    result.scanned === true &&
      regCandidate &&
      regCandidate.sizeBytes === null &&
      dirCandidate &&
      dirCandidate.sizeBytes === 2048 &&
      result.totalBytes === 2048,
    'Case 14: Unmeasured candidate keeps sizeBytes: null and is excluded from totalBytes sum',
    `regCandidate sizeBytes=${regCandidate?.sizeBytes}, dirCandidate sizeBytes=${dirCandidate?.sizeBytes}, totalBytes=${result.totalBytes}`
  );
})();

console.log('\n========================================');
console.log(`Total tests: ${testsPassed + testsFailed}`);
console.log(`Passed:      ${testsPassed}`);
console.log(`Failed:      ${testsFailed}`);
console.log('========================================\n');

if (testsFailed > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
