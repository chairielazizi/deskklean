// scripts/test-registry-fixer.mjs
// Pure-logic unit tests for Phase 7 RegistryFixer (Read-Only Scan).

import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

let pathCheckModule;
let scanUninstallModule;
let scanMuiCacheModule;
let registryFixerModule;

try {
  pathCheckModule = require('../dist/main/system/registry-fixer/path-check.js');
  scanUninstallModule = require('../dist/main/system/registry-fixer/scan-uninstall.js');
  scanMuiCacheModule = require('../dist/main/system/registry-fixer/scan-mui-cache.js');
  registryFixerModule = require('../dist/main/system/registry-fixer/index.js');
} catch {
  const { execSync } = require('child_process');
  execSync('npm run build:main', { cwd: path.resolve(__dirname, '..'), stdio: 'inherit' });
  pathCheckModule = require('../dist/main/system/registry-fixer/path-check.js');
  scanUninstallModule = require('../dist/main/system/registry-fixer/scan-uninstall.js');
  scanMuiCacheModule = require('../dist/main/system/registry-fixer/scan-mui-cache.js');
  registryFixerModule = require('../dist/main/system/registry-fixer/index.js');
}

const {
  checkPathOutcome,
  isNetworkPath,
  isUncPath,
  cleanPath,
  clearDriveTypeCache,
  DRIVE_REMOTE,
} = pathCheckModule;

const {
  scanUninstall,
  isSystemComponent,
  isWindowsInstallerOrRundllEntry,
  UNINSTALL_ROOTS,
} = scanUninstallModule;

const {
  scanMuiCache,
  extractMuiCacheFilePath,
  isCandidateFilePath,
  KNOWN_MUI_CACHE_SUFFIXES,
} = scanMuiCacheModule;

const { scanRegistryFixer } = registryFixerModule;

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
  console.log('=== Section 1: The Three-Outcome Filesystem Check (checkPathOutcome) ===\n');

  // 1a. Exists: stat succeeds
  {
    const outcome = await checkPathOutcome('C:\\Existing\\Dir', {
      statFn: async () => ({ isDirectory: () => true }),
    });
    assert(outcome === 'exists', '1a. Existing path returns "exists"');
  }

  // 1b. Gone: ENOENT returns "gone"
  {
    const outcome = await checkPathOutcome('C:\\Provably\\Gone\\Dir', {
      statFn: async () => {
        const err = new Error('File not found');
        err.code = 'ENOENT';
        throw err;
      },
    });
    assert(outcome === 'gone', '1b. ENOENT failure returns "gone" — the ONLY flag outcome');
  }

  // 1c. EACCES yields indeterminate, NOT gone
  {
    const outcome = await checkPathOutcome('C:\\Protected\\Dir', {
      statFn: async () => {
        const err = new Error('Permission denied');
        err.code = 'EACCES';
        throw err;
      },
    });
    assert(outcome === 'indeterminate', '1c. EACCES failure yields "indeterminate", NOT "gone"');
  }

  // 1d. EPERM yields indeterminate, NOT gone
  {
    const outcome = await checkPathOutcome('C:\\Protected\\Dir', {
      statFn: async () => {
        const err = new Error('Operation not permitted');
        err.code = 'EPERM';
        throw err;
      },
    });
    assert(outcome === 'indeterminate', '1d. EPERM failure yields "indeterminate", NOT "gone"');
  }

  // 1e. EIO yields indeterminate
  {
    const outcome = await checkPathOutcome('C:\\BadSector\\Dir', {
      statFn: async () => {
        const err = new Error('I/O error');
        err.code = 'EIO';
        throw err;
      },
    });
    assert(outcome === 'indeterminate', '1e. EIO failure yields "indeterminate", NOT "gone"');
  }

  // 1f. ENOTDIR yields indeterminate
  {
    const outcome = await checkPathOutcome('C:\\NotADir\\Sub', {
      statFn: async () => {
        const err = new Error('Not a directory');
        err.code = 'ENOTDIR';
        throw err;
      },
    });
    assert(outcome === 'indeterminate', '1f. ENOTDIR failure yields "indeterminate", NOT "gone"');
  }

  // 1g. Empty / whitespace path returns indeterminate
  {
    assert((await checkPathOutcome('')) === 'indeterminate', '1g. Empty string returns "indeterminate"');
    assert((await checkPathOutcome('   ')) === 'indeterminate', '1h. Whitespace string returns "indeterminate"');
  }

  // 1h. Strips quotes cleanly
  {
    let targetReceived = '';
    await checkPathOutcome('"C:\\Quoted\\Dir"', {
      statFn: async (p) => {
        targetReceived = p;
        return {};
      },
    });
    assert(targetReceived === 'C:\\Quoted\\Dir', '1i. Surrounding double quotes stripped before check', `Got: ${targetReceived}`);
  }

  console.log('\n=== Section 2: Network Path Detection (UNC & Mapped Drives) ===\n');

  // 2a. UNC path starting with \\ or //
  {
    assert(isUncPath('\\\\server\\share\\folder') === true, '2a. Path starting with \\\\ is recognized as UNC');
    assert(isUncPath('//server/share/folder') === true, '2b. Path starting with // is recognized as UNC');
    assert(isUncPath('"\\\\server\\share\\quoted"') === true, '2c. Quoted UNC path recognized as UNC');
    assert(isUncPath('C:\\Local\\Path') === false, '2d. Local C: path is not UNC');
  }

  // 2b. isNetworkPath with UNC
  {
    assert(await isNetworkPath('\\\\nas\\volume\\app') === true, '2e. isNetworkPath returns true for UNC \\\\');
    assert(await isNetworkPath('//nas/volume/app') === true, '2f. isNetworkPath returns true for UNC //');
  }

  // 2c. Mapped drive detection via Win32_LogicalDisk DriveType (DRIVE_REMOTE = 4)
  {
    const mockCache = new Map();
    let lookupsCount = 0;

    const mockLookup = async (driveLetter) => {
      lookupsCount++;
      if (driveLetter === 'Z') return DRIVE_REMOTE; // 4: remote
      if (driveLetter === 'C') return 3; // 3: fixed local
      if (driveLetter === 'D') return 3; // 3: another fixed local volume
      return null;
    };

    // Z: is remote
    const isZRemote = await isNetworkPath('Z:\\SharedApp\\bin', {
      driveTypeCache: mockCache,
      lookupDriveType: mockLookup,
    });
    assert(isZRemote === true, '2g. Drive Z: with DriveType 4 (DRIVE_REMOTE) is recognized as network path');
    assert(lookupsCount === 1, '2h. First query triggers drive lookup');

    // Repeated call for Z: uses cache
    await isNetworkPath('Z:\\AnotherApp', {
      driveTypeCache: mockCache,
      lookupDriveType: mockLookup,
    });
    assert(lookupsCount === 1, '2i. Subsequent query for drive Z: is resolved from cache without re-querying');

    // C: is local fixed
    const isCRemote = await isNetworkPath('C:\\Program Files\\App', {
      driveTypeCache: mockCache,
      lookupDriveType: mockLookup,
    });
    assert(isCRemote === false, '2j. Local C: drive is NOT a network path');

    // D: is local fixed (machine with multiple local volumes — NOT assumed remote!)
    const isDRemote = await isNetworkPath('D:\\Games\\Steam', {
      driveTypeCache: mockCache,
      lookupDriveType: mockLookup,
    });
    assert(isDRemote === false, '2k. Non-C local volume (D:) is NOT assumed remote');
  }

  console.log('\n=== Section 3: MUICache Suffix Stripping & Extraction ===\n');

  // 3a. Stripping known suffixes
  {
    assert(
      KNOWN_MUI_CACHE_SUFFIXES.includes('.ApplicationCompany'),
      '3a. Known suffixes include .ApplicationCompany'
    );
    assert(
      KNOWN_MUI_CACHE_SUFFIXES.includes('.ApplicationName'),
      '3b. Known suffixes include .ApplicationName'
    );

    const extracted1 = extractMuiCacheFilePath('C:\\Users\\User\\Downloads\\setup_temp.exe.ApplicationCompany');
    assert(
      extracted1 === 'C:\\Users\\User\\Downloads\\setup_temp.exe',
      '3c. Strips .ApplicationCompany correctly',
      `Got: ${extracted1}`
    );

    const extracted2 = extractMuiCacheFilePath('C:\\Users\\User\\Downloads\\setup_temp.exe.ApplicationName');
    assert(
      extracted2 === 'C:\\Users\\User\\Downloads\\setup_temp.exe',
      '3d. Strips .ApplicationName correctly',
      `Got: ${extracted2}`
    );

    const extractedCase = extractMuiCacheFilePath('C:\\Users\\User\\Downloads\\setup.exe.applicationname');
    assert(
      extractedCase === 'C:\\Users\\User\\Downloads\\setup.exe',
      '3e. Strips suffixes case-insensitively',
      `Got: ${extractedCase}`
    );

    const extractedNoSuffix = extractMuiCacheFilePath('C:\\Program Files\\App\\app.exe');
    assert(
      extractedNoSuffix === 'C:\\Program Files\\App\\app.exe',
      '3f. Leaves path without known suffix untouched'
    );
  }

  // 3b. isCandidateFilePath filtering
  {
    assert(isCandidateFilePath('C:\\Windows\\notepad.exe') === true, '3g. Drive-rooted path is valid candidate');
    assert(isCandidateFilePath('\\\\server\\share\\tool.exe') === true, '3h. UNC path is valid candidate');
    assert(isCandidateFilePath('LangID') === false, '3i. "LangID" is rejected as non-path');
    assert(isCandidateFilePath('') === false, '3j. Empty string is rejected as candidate');
  }

  console.log('\n=== Section 4: Orphaned Uninstall Detection (scanUninstall) ===\n');

  // 4a. Enumeration of all 3 standard roots
  {
    const queriedRoots = [];
    await scanUninstall({
      readEntries: async (hive, keyPath) => {
        queriedRoots.push(`${hive}\\${keyPath}`);
        return [];
      },
    });
    assert(queriedRoots.length === 3, '4a. Scans all 3 standard Uninstall roots by default');
    assert(queriedRoots.includes('HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall'), '4b. Includes HKLM Uninstall');
    assert(queriedRoots.includes('HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall'), '4c. Includes HKLM WOW6432Node Uninstall');
    assert(queriedRoots.includes('HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall'), '4d. Includes HKCU Uninstall');
  }

  // 4b. Four exclusions in order
  {
    const singleRoot = [{ hive: 'HKLM', keyPath: 'SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall' }];

    // Exclusion 1: SystemComponent = 1
    const resSysComp = await scanUninstall({
      roots: singleRoot,
      readEntries: async () => [
        {
          subKey: 'SysComponentApp',
          DisplayName: 'Windows System Component',
          InstallLocation: 'C:\\NonExistent\\SysComp',
          SystemComponent: 1,
        },
      ],
      statFn: async () => {
        const err = new Error('ENOENT');
        err.code = 'ENOENT';
        throw err;
      },
    });
    assert(resSysComp.issues.length === 0, '4e. SystemComponent = 1 entry is skipped (Exclusion 1)');
    assert(resSysComp.indeterminateCount === 0, '4f. Skipped SystemComponent does not increment indeterminate');

    // Exclusion 2: msiexec.exe / rundll32.exe in UninstallString or DisplayIcon
    const resMsi1 = await scanUninstall({
      roots: singleRoot,
      readEntries: async () => [
        {
          subKey: 'MsiApp1',
          DisplayName: 'MSI Installed App',
          InstallLocation: 'C:\\NonExistent\\MsiApp',
          UninstallString: 'MsiExec.exe /I{12345678-ABCD-1234-ABCD-123456789012}',
        },
      ],
      statFn: async () => {
        const err = new Error('ENOENT');
        err.code = 'ENOENT';
        throw err;
      },
    });
    assert(resMsi1.issues.length === 0, '4g. Entry with msiexec.exe in UninstallString is skipped (Exclusion 2)');

    const resMsi2 = await scanUninstall({
      roots: singleRoot,
      readEntries: async () => [
        {
          subKey: 'MsiApp2',
          DisplayName: 'MSI Installed App 2',
          InstallLocation: 'C:\\NonExistent\\MsiApp2',
          DisplayIcon: 'C:\\Windows\\System32\\msiexec.exe,0',
        },
      ],
      statFn: async () => {
        const err = new Error('ENOENT');
        err.code = 'ENOENT';
        throw err;
      },
    });
    assert(resMsi2.issues.length === 0, '4h. Entry with msiexec.exe in DisplayIcon is skipped (Exclusion 2)');

    const resRundll = await scanUninstall({
      roots: singleRoot,
      readEntries: async () => [
        {
          subKey: 'RundllApp',
          DisplayName: 'Rundll App',
          InstallLocation: 'C:\\NonExistent\\RundllApp',
          UninstallString: 'rundll32.exe "C:\\Program Files\\App\\uninstall.dll",Uninstall',
        },
      ],
      statFn: async () => {
        const err = new Error('ENOENT');
        err.code = 'ENOENT';
        throw err;
      },
    });
    assert(resRundll.issues.length === 0, '4i. Entry with rundll32.exe in UninstallString is skipped (Exclusion 2)');

    // Exclusion 3: Missing or empty InstallLocation
    const resNoLoc = await scanUninstall({
      roots: singleRoot,
      readEntries: async () => [
        {
          subKey: 'NoLocApp',
          DisplayName: 'App With No InstallLocation',
          InstallLocation: '',
        },
        {
          subKey: 'NullLocApp',
          DisplayName: 'App With Null InstallLocation',
          InstallLocation: undefined,
        },
      ],
      statFn: async () => {
        const err = new Error('ENOENT');
        err.code = 'ENOENT';
        throw err;
      },
    });
    assert(resNoLoc.issues.length === 0, '4j. Entries with absent or empty InstallLocation are skipped (Exclusion 3)');

    // Exclusion 4: Network paths (UNC and mapped drives)
    const mockCache = new Map();
    const mockLookup = async (letter) => (letter === 'Z' ? DRIVE_REMOTE : 3);

    const resNetwork = await scanUninstall({
      roots: singleRoot,
      driveTypeCache: mockCache,
      lookupDriveType: mockLookup,
      readEntries: async () => [
        {
          subKey: 'UncApp',
          DisplayName: 'Network UNC App',
          InstallLocation: '\\\\fileserver\\apps\\unc-app',
        },
        {
          subKey: 'MappedApp',
          DisplayName: 'Mapped Drive App',
          InstallLocation: 'Z:\\mapped-share\\app',
        },
      ],
      statFn: async () => {
        const err = new Error('ENOENT');
        err.code = 'ENOENT';
        throw err;
      },
    });
    assert(resNetwork.issues.length === 0, '4k. Network paths are never flagged');
    assert(resNetwork.skippedNetworkCount === 2, '4l. Network paths increment skippedNetworkCount', `Got: ${resNetwork.skippedNetworkCount}`);
  }

  // 4c. Three-outcome detection on valid candidate
  {
    const singleRoot = [{ hive: 'HKLM', keyPath: 'SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall' }];
    const mockEntries = [
      {
        subKey: 'GoneApp',
        DisplayName: 'Dead Software Suite',
        InstallLocation: 'C:\\Program Files\\DeadApp',
        UninstallString: 'C:\\Program Files\\DeadApp\\unins000.exe',
      },
      {
        subKey: 'ExistingApp',
        DisplayName: 'Active Valid Software',
        InstallLocation: 'C:\\Program Files\\ActiveApp',
        UninstallString: 'C:\\Program Files\\ActiveApp\\uninstall.exe',
      },
      {
        subKey: 'LockedApp',
        DisplayName: 'Permission Locked Directory',
        InstallLocation: 'C:\\Program Files\\LockedApp',
        UninstallString: 'C:\\Program Files\\LockedApp\\uninstall.exe',
      },
    ];

    const res = await scanUninstall({
      roots: singleRoot,
      readEntries: async () => mockEntries,
      statFn: async (targetPath) => {
        if (targetPath.includes('DeadApp')) {
          const err = new Error('ENOENT');
          err.code = 'ENOENT';
          throw err;
        }
        if (targetPath.includes('ActiveApp')) {
          return { isDirectory: () => true };
        }
        if (targetPath.includes('LockedApp')) {
          const err = new Error('EACCES');
          err.code = 'EACCES';
          throw err;
        }
        return {};
      },
    });

    assert(res.issues.length === 1, '4m. Only provably gone directory is flagged', `Count: ${res.issues.length}`);
    const flagged = res.issues[0];
    assert(flagged.displayName === 'Dead Software Suite', '4n. Flagged issue has correct displayName');
    assert(flagged.type === 'orphaned_uninstall', '4o. Flagged issue type is "orphaned_uninstall"');
    assert(flagged.severity === 'low', '4p. Severity is strictly "low" (housekeeping, not severity metric)');
    assert(flagged.selected === true, '4q. Issue is selected: true');
    assert(flagged.evidence.checkedPath === 'C:\\Program Files\\DeadApp', '4r. Evidence checkedPath is exact path');
    assert(flagged.evidence.outcome === 'gone', '4s. Evidence outcome is strictly "gone"');

    // Locked directory: indeterminate, not flagged
    assert(res.indeterminateCount === 1, '4t. EACCES directory increments indeterminateCount (not hidden)', `Got: ${res.indeterminateCount}`);
  }

  console.log('\n=== Section 5: Stale MUICache Detection (scanMuiCache) ===\n');

  {
    const mockValues = {
      'C:\\Users\\User\\Downloads\\setup_temp.exe.ApplicationCompany': 'Mock Installer Inc.',
      'C:\\Users\\User\\Downloads\\setup_temp.exe.ApplicationName': 'Setup Temporary Installer',
      'C:\\Users\\User\\AppData\\Local\\ActiveTool.exe.ApplicationName': 'Active Tool',
      'C:\\Users\\User\\Protected\\AdminTool.exe.ApplicationName': 'Admin Tool',
      '\\\\server\\share\\remote_tool.exe.ApplicationName': 'Remote Network Tool',
      'LangID': 1033, // Non-path entry, should be ignored
    };

    const resMui = await scanMuiCache({
      readValues: async () => mockValues,
      statFn: async (targetPath) => {
        if (targetPath.includes('setup_temp.exe')) {
          const err = new Error('ENOENT');
          err.code = 'ENOENT';
          throw err;
        }
        if (targetPath.includes('ActiveTool.exe')) {
          return { isFile: () => true };
        }
        if (targetPath.includes('AdminTool.exe')) {
          const err = new Error('EPERM');
          err.code = 'EPERM';
          throw err;
        }
        return {};
      },
    });

    assert(resMui.issues.length === 2, '5a. Flags both .ApplicationCompany and .ApplicationName for provably gone exe', `Got: ${resMui.issues.length}`);
    for (const issue of resMui.issues) {
      assert(issue.type === 'stale_mui_cache', '5b. Issue type is stale_mui_cache');
      assert(issue.severity === 'low', '5c. Issue severity is low');
      assert(issue.evidence.checkedPath === 'C:\\Users\\User\\Downloads\\setup_temp.exe', '5d. Issue checkedPath is stripped executable path');
      assert(issue.evidence.outcome === 'gone', '5e. Issue evidence outcome is "gone"');
      assert(typeof issue.valueName === 'string', '5f. Carries original valueName');
    }

    assert(resMui.indeterminateCount === 1, '5g. EPERM failure increments indeterminateCount');
    assert(resMui.skippedNetworkCount === 1, '5h. UNC path increments skippedNetworkCount');
  }

  console.log('\n=== Section 6: Combined RegistryFixer Scanner (scanRegistryFixer) ===\n');

  {
    const resCombined = await scanRegistryFixer({
      roots: [{ hive: 'HKLM', keyPath: 'SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall' }],
      readEntries: async () => [
        {
          subKey: 'DeadSubKey',
          DisplayName: 'Dead App',
          InstallLocation: 'C:\\Gone\\App',
        },
      ],
      readValues: async () => ({
        'C:\\Gone\\Tool.exe.ApplicationName': 'Dead Tool',
      }),
      statFn: async () => {
        const err = new Error('ENOENT');
        err.code = 'ENOENT';
        throw err;
      },
    });

    assert(Array.isArray(resCombined.issues), '6a. Returns issues array');
    assert(resCombined.issues.length === 2, '6b. Combines issues from uninstall and mui_cache', `Count: ${resCombined.issues.length}`);
    assert(typeof resCombined.scannedAt === 'string', '6c. Carries scannedAt ISO timestamp');
    assert(typeof resCombined.indeterminateCount === 'number', '6d. Carries indeterminateCount');
    assert(typeof resCombined.skippedNetworkCount === 'number', '6e. Carries skippedNetworkCount');

    // Verify all flagged issues satisfy the binding rule
    for (const issue of resCombined.issues) {
      assert(issue.evidence.outcome === 'gone', '6f. Every flagged issue proves target is gone');
      assert(issue.severity === 'low', '6g. Severity is strictly low');
      assert(issue.selected === true, '6h. Default selected is true');
    }
  }

  console.log('\n=== Section 7: Negative Tests (Never Flag on Heuristic / Age / Publisher) ===\n');

  {
    const singleRoot = [{ hive: 'HKLM', keyPath: 'SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall' }];

    // A missing file on a mapped network drive must NEVER be flagged
    const mockCache = new Map();
    const resRemoteDead = await scanUninstall({
      roots: singleRoot,
      driveTypeCache: mockCache,
      lookupDriveType: async () => DRIVE_REMOTE,
      readEntries: async () => [
        {
          subKey: 'DeadRemoteApp',
          DisplayName: 'Dead Remote App',
          InstallLocation: 'Z:\\DeadShare\\App',
        },
      ],
      statFn: async () => {
        const err = new Error('ENOENT');
        err.code = 'ENOENT';
        throw err;
      },
    });
    assert(resRemoteDead.issues.length === 0, '7a. Target on mapped drive is skipped even when stat returns ENOENT (reachability is not provability)');
    assert(resRemoteDead.skippedNetworkCount === 1, '7b. Mapped drive target incremented skippedNetworkCount');

    // Unknown publisher or old timestamp does NOT cause flag if directory exists
    const resValidOldApp = await scanUninstall({
      roots: singleRoot,
      readEntries: async () => [
        {
          subKey: 'OldUnknownApp',
          DisplayName: 'Old Unknown 2005 App',
          InstallLocation: 'C:\\OldApp',
        },
      ],
      statFn: async () => ({ isDirectory: () => true }),
    });
    assert(resValidOldApp.issues.length === 0, '7c. Existing directory is NOT flagged regardless of age or name');
  }

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
  console.error('Test runner failed:', err);
  process.exit(1);
});
