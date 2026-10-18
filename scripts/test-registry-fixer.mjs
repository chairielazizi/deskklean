// scripts/test-registry-fixer.mjs
// Pure-logic unit tests for Phase 7 RegistryFixer (Read-Only Scan).

import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import os from 'os';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

let pathCheckModule;
let scanUninstallModule;
let scanMuiCacheModule;
let fixModule;
let backupModule;
let registryFixerModule;
let executeModule;

try {
  pathCheckModule = require('../dist/main/system/registry-fixer/path-check.js');
  scanUninstallModule = require('../dist/main/system/registry-fixer/scan-uninstall.js');
  scanMuiCacheModule = require('../dist/main/system/registry-fixer/scan-mui-cache.js');
  fixModule = require('../dist/main/system/registry-fixer/fix.js');
  backupModule = require('../dist/main/system/registry-fixer/backup.js');
  registryFixerModule = require('../dist/main/system/registry-fixer/index.js');
  executeModule = require('../dist/main/system/framework/execute.js');
} catch {
  const { execSync } = require('child_process');
  execSync('npm run build:main', { cwd: path.resolve(__dirname, '..'), stdio: 'inherit' });
  pathCheckModule = require('../dist/main/system/registry-fixer/path-check.js');
  scanUninstallModule = require('../dist/main/system/registry-fixer/scan-uninstall.js');
  scanMuiCacheModule = require('../dist/main/system/registry-fixer/scan-mui-cache.js');
  fixModule = require('../dist/main/system/registry-fixer/fix.js');
  backupModule = require('../dist/main/system/registry-fixer/backup.js');
  registryFixerModule = require('../dist/main/system/registry-fixer/index.js');
  executeModule = require('../dist/main/system/framework/execute.js');
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
  stripKnownSuffix,
  isCandidateFilePath,
  KNOWN_MUI_CACHE_SUFFIXES,
} = scanMuiCacheModule;

const { scanRegistryFixer } = registryFixerModule;

const {
  createRegistryFixPlan,
  executeRegistryFix,
  validateRegistryFixTarget,
} = fixModule;

const {
  formatRegistryFixerBackup,
  writeRegistryFixerBackupFile,
  validateRegBackupFile,
  buildBackupSnippet,
} = backupModule;

const { executeRegistryDeletions } = executeModule;

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
      KNOWN_MUI_CACHE_SUFFIXES.includes('.FriendlyAppName'),
      '3b. Known suffixes include .FriendlyAppName'
    );
    assert(
      KNOWN_MUI_CACHE_SUFFIXES.includes('.ApplicationName'),
      '3c. Known suffixes include .ApplicationName'
    );

    const extracted1 = extractMuiCacheFilePath('C:\\Users\\User\\Downloads\\setup_temp.exe.ApplicationCompany');
    assert(
      extracted1 === 'C:\\Users\\User\\Downloads\\setup_temp.exe',
      '3d. Strips .ApplicationCompany correctly',
      `Got: ${extracted1}`
    );

    const extractedFriendly = extractMuiCacheFilePath('C:\\Windows\\explorer.exe.FriendlyAppName');
    assert(
      extractedFriendly === 'C:\\Windows\\explorer.exe',
      '3e. Strips .FriendlyAppName correctly',
      `Got: ${extractedFriendly}`
    );

    const extracted2 = extractMuiCacheFilePath('C:\\Users\\User\\Downloads\\setup_temp.exe.ApplicationName');
    assert(
      extracted2 === 'C:\\Users\\User\\Downloads\\setup_temp.exe',
      '3f. Strips .ApplicationName correctly',
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

  // 3c. stripKnownSuffix reports matched status
  {
    const sKnown = stripKnownSuffix('C:\\Windows\\explorer.exe.FriendlyAppName');
    assert(sKnown.suffixMatched === true && sKnown.filePath === 'C:\\Windows\\explorer.exe', '3k. stripKnownSuffix reports suffixMatched: true for known suffix');
    assert(sKnown.matchedSuffix === '.FriendlyAppName', '3l. stripKnownSuffix identifies matched suffix');

    const sUnknown = stripKnownSuffix('C:\\Windows\\explorer.exe.SomeSuffixNobodyListed');
    assert(sUnknown.suffixMatched === false && sUnknown.filePath === 'C:\\Windows\\explorer.exe.SomeSuffixNobodyListed', '3m. stripKnownSuffix reports suffixMatched: false for unknown suffix');
    assert(sUnknown.matchedSuffix === undefined, '3n. stripKnownSuffix has undefined matchedSuffix for unknown suffix');

    const sIcon = stripKnownSuffix('C:\\App\\tool.exe.ApplicationIcon');
    assert(sIcon.suffixMatched === false, '3o. stripKnownSuffix reports suffixMatched: false for .ApplicationIcon');

    const sLang = stripKnownSuffix('C:\\App\\tool.exe.Language');
    assert(sLang.suffixMatched === false, '3p. stripKnownSuffix reports suffixMatched: false for .Language');
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

  // 5i-5k. Regression: Unknown suffix produces ZERO flags and increments indeterminateCount (CLASS fix)
  {
    const resUnknown = await scanMuiCache({
      readValues: async () => ({
        'C:\\Windows\\explorer.exe.SomeSuffixNobodyListed': 'Windows Explorer',
      }),
      statFn: async () => {
        // Even when filesystem check fails (ENOENT), unknown suffix must NOT be flagged!
        const err = new Error('ENOENT');
        err.code = 'ENOENT';
        throw err;
      },
    });
    assert(resUnknown.issues.length === 0, '5i. Unknown suffix produces ZERO flags (prevents 318 false-positive bug)');
    assert(resUnknown.indeterminateCount === 1, '5j. Unknown suffix increments indeterminateCount');
    assert(resUnknown.skippedNetworkCount === 0, '5k. Unknown suffix on local drive does not affect skippedNetworkCount');
  }

  // 5l-5m. Regression: .ApplicationIcon and .Language produce zero flags and increment indeterminateCount
  {
    const resOtherSuffixes = await scanMuiCache({
      readValues: async () => ({
        'C:\\Program Files\\Vendor\\Tool.exe.ApplicationIcon': '@{Package?ms-resource://...}',
        'C:\\Program Files\\Vendor\\Tool.exe.Language': 'en-US',
      }),
      statFn: async () => {
        const err = new Error('ENOENT');
        err.code = 'ENOENT';
        throw err;
      },
    });
    assert(resOtherSuffixes.issues.length === 0, '5l. .ApplicationIcon and .Language produce ZERO flags');
    assert(resOtherSuffixes.indeterminateCount === 2, '5m. .ApplicationIcon and .Language increment indeterminateCount (2 uncheckable entries)');
  }

  // 5n-5p. Step 1: Raw value name that resolves as real path is NOT flagged even if it ends with known suffix
  {
    let strippedChecked = false;
    const resRawExists = await scanMuiCache({
      readValues: async () => ({
        'C:\\Tools\\setup.ApplicationName': 'Literal setup.ApplicationName tool',
      }),
      statFn: async (targetPath) => {
        if (targetPath === 'C:\\Tools\\setup.ApplicationName') {
          return { isFile: () => true }; // The literal file exists
        }
        if (targetPath === 'C:\\Tools\\setup') {
          strippedChecked = true;
          const err = new Error('ENOENT');
          err.code = 'ENOENT';
          throw err;
        }
        return {};
      },
    });
    assert(resRawExists.issues.length === 0, '5n. Raw value name that exists is NOT flagged (Step 1)');
    assert(resRawExists.indeterminateCount === 0, '5o. Raw existing path does not increment indeterminateCount');
    assert(strippedChecked === false, '5p. Step 1 skips before stripping: stripped path was never checked');
  }

  // 5q-5t. Step 3: All three known suffixes strip and flag correctly when target is genuinely gone
  {
    const resKnownGone = await scanMuiCache({
      readValues: async () => ({
        'C:\\Program Files\\OldApp\\app.exe.ApplicationCompany': 'Old Corp',
        'C:\\Program Files\\OldApp\\app.exe.FriendlyAppName': 'Old Application',
        'C:\\Program Files\\OldApp\\app.exe.ApplicationName': 'Old App Display',
      }),
      statFn: async () => {
        const err = new Error('ENOENT');
        err.code = 'ENOENT';
        throw err;
      },
    });
    assert(resKnownGone.issues.length === 3, '5q. All 3 known suffixes flag when target file is genuinely gone');
    assert(resKnownGone.indeterminateCount === 0, '5r. Zero indeterminate for known suffixes with confirmed ENOENT');
    for (const issue of resKnownGone.issues) {
      assert(issue.evidence.checkedPath === 'C:\\Program Files\\OldApp\\app.exe', '5s. Evidence checkedPath is stripped executable path');
      assert(issue.evidence.outcome === 'gone', '5t. Evidence outcome is strictly "gone"');
    }
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

  console.log('\n=== Section 8: Target Validation & Safety Policy (validateRegistryFixTarget) ===\n');

  {
    const emptyCheck = validateRegistryFixTarget('HKLM', '', 'orphaned_uninstall');
    assert(!emptyCheck.allowed, '8a. Empty keyPath is rejected');

    const nullCheck = validateRegistryFixTarget('HKLM', 'SOFTWARE\\App\0Bad', 'orphaned_uninstall');
    assert(!nullCheck.allowed, '8b. KeyPath with null byte is rejected');

    const protectedCheck = validateRegistryFixTarget('HKLM', 'SYSTEM\\CurrentControlSet\\Control\\SafeBoot', 'orphaned_uninstall');
    assert(!protectedCheck.allowed, '8c. Protected framework registry path is rejected');

    const rootUninstallCheck = validateRegistryFixTarget('HKLM', 'SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall', 'orphaned_uninstall');
    assert(!rootUninstallCheck.allowed, '8d. Root Uninstall container itself cannot be deleted');

    const validTargetCheck = validateRegistryFixTarget('HKLM', 'SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\DeadApp123', 'orphaned_uninstall');
    assert(validTargetCheck.allowed, '8e. Valid orphaned uninstall subkey is allowed');
  }

  console.log('\n=== Section 9: Plan Generation (createRegistryFixPlan) ===\n');

  {
    const sampleIssues = [
      {
        id: 'uninst-1',
        type: 'orphaned_uninstall',
        hive: 'HKLM',
        keyPath: 'SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\DeadApp',
        displayName: 'Dead App',
        severity: 'low',
        selected: true,
        evidence: { checkedPath: 'C:\\DeadApp', outcome: 'gone' },
      },
      {
        id: 'mui-1',
        type: 'stale_mui_cache',
        hive: 'HKCU',
        keyPath: 'Software\\Classes\\Local Settings\\Software\\Microsoft\\Windows\\Shell\\MuiCache',
        valueName: 'C:\\Old\\tool.exe.ApplicationName',
        displayName: 'Old Tool',
        severity: 'low',
        selected: true,
        evidence: { checkedPath: 'C:\\Old\\tool.exe', outcome: 'gone' },
      },
    ];

    const planBoth = createRegistryFixPlan(sampleIssues);
    assert(planBoth.module === 'registry-fixer', '9a. Plan module is "registry-fixer"');
    assert(planBoth.reversibility === 'reversible', '9b. Plan reversibility is "reversible" (.reg backup guarantee)');
    assert(planBoth.totalReclaimableBytes === null, '9c. totalReclaimableBytes is strictly null (never estimated)');
    assert(planBoth.requiresElevation === true, '9d. requiresElevation is true because HKLM is targeted');
    assert(planBoth.actions.length === 2, '9e. Contains 2 actions');

    const uninstAction = planBoth.actions.find((a) => a.id === 'uninst-1');
    assert(uninstAction && uninstAction.kind === 'registry-key', '9f. Orphaned uninstall maps to "registry-key" action');
    assert(uninstAction.reclaimableBytes === null, '9g. Action reclaimableBytes is strictly null');

    const muiAction = planBoth.actions.find((a) => a.id === 'mui-1');
    assert(muiAction && muiAction.kind === 'registry-value', '9h. Stale MUICache maps to "registry-value" action');

    // HKCU-only plan requiresElevation is false
    const planHkcu = createRegistryFixPlan([sampleIssues[1]]);
    assert(planHkcu.requiresElevation === false, '9i. requiresElevation is false when only HKCU is targeted');

    // Filtering by selectedIssueIds
    const planFiltered = createRegistryFixPlan(sampleIssues, ['mui-1']);
    assert(planFiltered.actions.length === 1 && planFiltered.actions[0].id === 'mui-1', '9j. Honors selectedIssueIds filter');

    // Target violating protection goes to blocked
    const unsafeIssue = {
      id: 'unsafe-1',
      type: 'orphaned_uninstall',
      hive: 'HKLM',
      keyPath: 'SYSTEM\\CurrentControlSet\\Control\\SafeBoot',
      displayName: 'System Core',
      severity: 'low',
      selected: true,
      evidence: { checkedPath: 'C:\\Windows', outcome: 'gone' },
    };
    const planUnsafe = createRegistryFixPlan([unsafeIssue]);
    assert(planUnsafe.actions.length === 0, '9k. Unsafe target is not added to planned actions');
    assert(planUnsafe.blocked.length === 1, '9l. Unsafe target is recorded in blocked list');
  }

  console.log('\n=== Section 10: Backup Formatting & File Validation (format / write / validate) ===\n');

  {
    const backupEntries = [
      {
        type: 'orphaned_uninstall',
        hive: 'HKLM',
        keyPath: 'SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\DeadApp',
        values: [
          { name: 'DisplayName', type: 'String', data: 'Dead App' },
          { name: 'InstallLocation', type: 'String', data: 'C:\\DeadApp' },
        ],
      },
      {
        type: 'stale_mui_cache',
        hive: 'HKCU',
        keyPath: 'Software\\Classes\\Local Settings\\Software\\Microsoft\\Windows\\Shell\\MuiCache',
        valueName: 'C:\\Old\\tool.exe.ApplicationName',
        valueType: 'REG_SZ',
        data: 'Old Tool',
      },
    ];

    const content = formatRegistryFixerBackup(backupEntries, '2026-10-18T00:00:00.000Z');
    assert(content.startsWith('Windows Registry Editor Version 5.00'), '10a. Starts with Windows Registry Editor header');
    assert(content.includes('; DeskKlean Backup Metadata'), '10b. Contains metadata comment block');
    assert(content.includes('\r\n'), '10c. Uses CRLF line endings');
    assert(content.includes('[HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\DeadApp]'), '10d. Contains long-form HKLM section header');
    assert(content.includes('[HKEY_CURRENT_USER\\Software\\Classes\\Local Settings\\Software\\Microsoft\\Windows\\Shell\\MuiCache]'), '10e. Contains long-form HKCU section header');

    // Test writing and validating file on disk
    const tmpDir = path.join(os.tmpdir(), `deskklean-test-${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    const tmpBackupFile = path.join(tmpDir, 'test-backup.reg');

    try {
      writeRegistryFixerBackupFile(tmpBackupFile, content);
      assert(fs.existsSync(tmpBackupFile), '10f. writeRegistryFixerBackupFile creates file');

      // Verify BOM
      const fileBytes = fs.readFileSync(tmpBackupFile);
      assert(fileBytes[0] === 0xff && fileBytes[1] === 0xfe, '10g. File starts with UTF-16LE BOM (FF FE)');

      const valResult = validateRegBackupFile(tmpBackupFile);
      assert(valResult.valid === true, '10h. validateRegBackupFile reports valid: true for correctly formatted backup');

      // Negative validation tests
      const nonExistentVal = validateRegBackupFile(path.join(tmpDir, 'does-not-exist.reg'));
      assert(nonExistentVal.valid === false, '10i. validateRegBackupFile returns false for non-existent file');

      const corruptedNoBom = path.join(tmpDir, 'no-bom.reg');
      fs.writeFileSync(corruptedNoBom, 'Windows Registry Editor Version 5.00\r\n\r\n[HKEY_CURRENT_USER\\Test]\r\n', 'utf8');
      const valNoBom = validateRegBackupFile(corruptedNoBom);
      assert(valNoBom.valid === false && valNoBom.reason.includes('BOM'), '10j. validateRegBackupFile rejects file missing UTF-16LE BOM');

      const corruptedBadHeader = path.join(tmpDir, 'bad-header.reg');
      fs.writeFileSync(corruptedBadHeader, '\uFEFFNot A Reg File\r\n', { encoding: 'utf16le' });
      const valBadHeader = validateRegBackupFile(corruptedBadHeader);
      assert(valBadHeader.valid === false && valBadHeader.reason.includes('header'), '10k. validateRegBackupFile rejects invalid header');
    } finally {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {}
    }
  }

  console.log('\n=== Section 11: Execution Engine Pipeline (executeRegistryDeletions / executeRegistryFix) ===\n');

  {
    const hklmIssue = {
      id: 'hklm-test-1',
      type: 'orphaned_uninstall',
      hive: 'HKLM',
      keyPath: 'SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\DeadAdminApp',
      displayName: 'Dead Admin App',
      severity: 'low',
      selected: true,
      evidence: { checkedPath: 'C:\\DeadAdminApp', outcome: 'gone' },
    };

    // 11a. Rail: Refuse to run unelevated if HKLM entries are selected
    const resElevCheck = await executeRegistryFix([hklmIssue], undefined, {
      isElevatedFn: async () => false,
    });
    assert(resElevCheck.success === false, '11a. Refuses execution up front when unelevated and HKLM is targeted');
    assert(resElevCheck.message.includes('Administrator rights are required'), '11b. Message informs user admin rights required');

    // 11c. Rail: An entry already removed by another process is a no-op (skipped: 1, not success, not fail)
    const hkcuIssue = {
      id: 'hkcu-test-1',
      type: 'stale_mui_cache',
      hive: 'HKCU',
      keyPath: 'Software\\Classes\\Local Settings\\Software\\Microsoft\\Windows\\Shell\\MuiCache',
      valueName: 'C:\\Old\\gone.exe.ApplicationName',
      displayName: 'Gone Tool',
      severity: 'low',
      selected: true,
      evidence: { checkedPath: 'C:\\Old\\gone.exe', outcome: 'gone' },
    };

    const tmpBackupDir = path.join(os.tmpdir(), `deskklean-exec-test-${Date.now()}`);
    fs.mkdirSync(tmpBackupDir, { recursive: true });

    try {
      const planAlreadyAbsent = createRegistryFixPlan([hkcuIssue]);
      const resAbsent = await executeRegistryDeletions(planAlreadyAbsent, undefined, {
        backupDirOverride: tmpBackupDir,
        keyExistsFn: async () => false,
        readValueFn: async () => ({ exists: false }),
      });
      assert(resAbsent.success === false, '11c. Entry already absent returns success: false');
      assert(resAbsent.skipped === 1, '11d. Entry already absent increments skipped count');
      assert(resAbsent.completed === 0 && resAbsent.failed === 0, '11e. Entry already absent has completed: 0 and failed: 0');
      assert(resAbsent.message.includes('already absent'), '11f. Message notes already absent');

      // 11g. Rail: Backup validation failure aborts before any delete call is made
      let deleteCalled = false;
      const planValFail = createRegistryFixPlan([hkcuIssue]);
      const resValFail = await executeRegistryDeletions(planValFail, undefined, {
        backupDirOverride: tmpBackupDir,
        keyExistsFn: async () => true,
        readValueFn: async () => ({ exists: true, type: 'REG_SZ', data: 'Tool' }),
        readSubKeyValuesWithTypesFn: async () => [],
        validateBackupFn: () => ({ valid: false, reason: 'Simulated backup corruption' }),
        deleteValueFn: async () => { deleteCalled = true; },
      });
      assert(resValFail.success === false, '11g. Aborts when backup validation fails');
      assert(deleteCalled === false, '11h. NO deletion call is executed when backup validation fails');
      assert(resValFail.message.includes('Backup validation failed'), '11i. Reports validation failure reason');

      // 11j. Rail: A delete that silently did nothing must report failure (verification check)
      const planSilentFail = createRegistryFixPlan([hkcuIssue]);
      const resSilentFail = await executeRegistryDeletions(planSilentFail, undefined, {
        backupDirOverride: tmpBackupDir,
        keyExistsFn: async () => true,
        readValueFn: async () => ({ exists: true, type: 'REG_SZ', data: 'Tool' }), // Still exists after delete!
        readSubKeyValuesWithTypesFn: async () => [],
        deleteValueFn: async () => {},
      });
      assert(resSilentFail.success === false, '11j. If entry still exists after delete, reports failure (never false success)');
      assert(resSilentFail.failed === 1, '11k. Failed count incremented when delete silently failed');

      // 11l. Successful execution confirmed
      let valueDeleted = false;
      let checkCount = 0;
      const planSuccess = createRegistryFixPlan([hkcuIssue]);
      const resSuccess = await executeRegistryDeletions(planSuccess, undefined, {
        backupDirOverride: tmpBackupDir,
        keyExistsFn: async () => false,
        readValueFn: async () => {
          checkCount++;
          // First check: exists (pre-flight). Second check: gone (post-delete verification).
          return { exists: checkCount === 1, type: 'REG_SZ', data: 'Tool' };
        },
        readSubKeyValuesWithTypesFn: async () => [],
        deleteValueFn: async () => { valueDeleted = true; },
      });
      assert(resSuccess.success === true, '11l. Confirmed deletion returns success: true');
      assert(resSuccess.completed === 1, '11m. Completed count is 1');
      assert(resSuccess.failed === 0, '11n. Failed count is 0');
      assert(valueDeleted === true, '11o. deleteValueFn was called');
      assert(typeof resSuccess.backupPath === 'string' && fs.existsSync(resSuccess.backupPath), '11p. Backup file exists on disk');

      // 11q. Partial failure reporting
      const issueA = { ...hkcuIssue, id: 'item-a', valueName: 'val-a' };
      const issueB = { ...hkcuIssue, id: 'item-b', valueName: 'val-b' };
      const planPartial = createRegistryFixPlan([issueA, issueB]);
      let callMap = {};
      const resPartial = await executeRegistryDeletions(planPartial, undefined, {
        backupDirOverride: tmpBackupDir,
        readValueFn: async (h, k, v) => {
          if (!callMap[v]) {
            callMap[v] = 1;
            return { exists: true, type: 'REG_SZ', data: 'Tool' };
          }
          // On second read: val-a was deleted, val-b still exists
          return { exists: v === 'val-b', type: 'REG_SZ', data: 'Tool' };
        },
        readSubKeyValuesWithTypesFn: async () => [],
        deleteValueFn: async (h, k, v) => {
          if (v === 'val-b') throw new Error('Access denied');
        },
      });
      assert(resPartial.success === false, '11q. Partial failure reports success: false');
      assert(resPartial.completed === 1, '11r. Partial failure reports completed: 1');
      assert(resPartial.failed === 1, '11s. Partial failure reports failed: 1');
    } finally {
      try {
        fs.rmSync(tmpBackupDir, { recursive: true, force: true });
      } catch {}
    }
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
