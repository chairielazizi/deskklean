// scripts/test-appremover.mjs
// Pure-logic unit tests for Phase 12 App Remover.

import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import os from 'os';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

let appRemoverModule;
let frameworkModule;

try {
  appRemoverModule = require('../dist/main/system/appRemover.js');
  frameworkModule = require('../dist/main/system/framework/index.js');
} catch {
  const { execSync } = require('child_process');
  execSync('npm run build:main', { cwd: path.resolve(__dirname, '..'), stdio: 'inherit' });
  appRemoverModule = require('../dist/main/system/appRemover.js');
  frameworkModule = require('../dist/main/system/framework/index.js');
}

const {
  isSystemComponentEntry,
  isParentKeyPresent,
  normalizeInstallDate,
  convertEstimatedSize,
  resolveProductCode,
  tokenizeArgs,
  parseUninstallString,
  detectUninstallerType,
  buildUninstallCommand,
  filterAndMapRegistryEntry,
  filterAndMapStoreEntry,
  createAppUninstallPlan,
  createRemoveAppRegistryEntryPlan,
  waitForProcessTree,
  checkPendingReboot,
  verifyAppRemoved,
  D_AR_9_IRREVERSIBILITY_REASON,
} = appRemoverModule;

const {
  createOperationPlan,
  executeUninstallActions,
  getOperationPlan,
  clearAllOperationPlans,
} = frameworkModule;

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
  console.log('=== Section 1: UninstallString Parsing (Step 2) ===\n');

  // 1a. Bare path with no arguments
  const p1 = parseUninstallString('C:\\MyApp\\uninstall.exe');
  assert(
    p1.executable === 'C:\\MyApp\\uninstall.exe' && p1.args.length === 0,
    '1a. Bare path with no arguments parsed cleanly'
  );

  // 1b. Quoted path with no arguments
  const p2 = parseUninstallString('"C:\\Program Files\\MyApp\\uninstall.exe"');
  assert(
    p2.executable === 'C:\\Program Files\\MyApp\\uninstall.exe' && p2.args.length === 0,
    '1b. Quoted path with spaces parsed cleanly'
  );

  // 1c. Quoted path with silent arguments
  const p3 = parseUninstallString('"C:\\Program Files (x86)\\App\\unins000.exe" /SILENT /NORESTART');
  assert(
    p3.executable === 'C:\\Program Files (x86)\\App\\unins000.exe' &&
      p3.args.length === 2 &&
      p3.args[0] === '/SILENT' &&
      p3.args[1] === '/NORESTART',
    '1c. Quoted path with arguments parsed into array'
  );

  // 1d. Bare path with spaces and arguments
  const p4 = parseUninstallString('C:\\Program Files\\App\\uninstall.exe /S /allusers');
  assert(
    p4.executable === 'C:\\Program Files\\App\\uninstall.exe' &&
      p4.args.length === 2 &&
      p4.args[0] === '/S' &&
      p4.args[1] === '/allusers',
    '1d. Bare path with spaces identified up to .exe boundary'
  );

  // 1e. Quoted argument with embedded spaces and switches
  const p5 = parseUninstallString('setup.exe /s /v"/qn /l*v \\"C:\\log.txt\\""');
  assert(
    p5.executable === 'setup.exe' &&
      p5.args.length === 2 &&
      p5.args[0] === '/s' &&
      p5.args[1].startsWith('/v"'),
    '1e. Preserves complex quoted arguments for installer switches'
  );

  // 1f. Empty string handling
  const p6 = parseUninstallString('');
  assert(
    p6.executable === '' && p6.args.length === 0,
    '1f. Empty UninstallString returns empty executable without throwing'
  );

  console.log('\n=== Section 2: Silent-Flag Detection (D-AR-3, Step 2) ===\n');

  // 2a. MSI detection
  assert(
    detectUninstallerType('msiexec.exe', 'msiexec.exe /x {12345678-1234-1234-1234-123456789012}', true) === 'msi',
    '2a. MSI detected via isMsi flag and msiexec executable'
  );

  // 2b. Inno Setup detection via unins000.exe
  assert(
    detectUninstallerType('C:\\App\\unins000.exe', 'C:\\App\\unins000.exe') === 'inno',
    '2b. Inno Setup detected via unins000.exe filename'
  );

  // 2c. Inno Setup command construction appends /SILENT
  const innoApp = {
    id: 'test-inno',
    name: 'Inno Test App',
    publisher: 'Test',
    version: '1.0',
    installDate: '2024-01-01',
    sizeBytes: 1024,
    installLocation: 'C:\\App',
    uninstallString: '"C:\\App\\unins000.exe"',
    quietUninstallString: null,
    productCode: null,
    isMsi: false,
    isStoreApp: false,
    uninstallMethod: 'uninstall-string',
    leftoversDetected: null,
  };
  const innoCmd = buildUninstallCommand(innoApp, { fileExists: () => true });
  assert(
    innoCmd.type === 'inno' && innoCmd.args.includes('/SILENT') && innoCmd.isSilent === true,
    '2c. Inno Setup command construction appends /SILENT flag'
  );

  // 2d. Inno Setup does not duplicate /SILENT if already present
  const innoAppExisting = {
    ...innoApp,
    uninstallString: '"C:\\App\\unins000.exe" /SILENT',
  };
  const innoCmdExisting = buildUninstallCommand(innoAppExisting, { fileExists: () => true });
  assert(
    innoCmdExisting.args.filter((a) => a.toLowerCase() === '/silent').length === 1,
    '2d. Inno Setup does not duplicate /SILENT when already present'
  );

  // 2e. NSIS detection via uninstall.exe
  assert(
    detectUninstallerType('C:\\Program Files\\App\\uninstall.exe') === 'nsis',
    '2e. NSIS detected via uninstall.exe filename'
  );

  // 2f. NSIS silent command construction appends /S as last argument
  const nsisApp = {
    ...innoApp,
    id: 'test-nsis',
    name: 'NSIS Test App',
    uninstallString: '"C:\\Program Files\\App\\uninstall.exe" /allusers',
  };
  const nsisCmd = buildUninstallCommand(nsisApp, { fileExists: () => true });
  assert(
    nsisCmd.type === 'nsis' &&
      nsisCmd.args[nsisCmd.args.length - 1] === '/S' &&
      nsisCmd.isSilent === true,
    '2f. NSIS silent flag /S appended as the last argument (D-AR-3)'
  );

  // 2g. InstallShield detection & flag /s
  assert(
    detectUninstallerType('C:\\App\\_isuninst.exe') === 'installshield',
    '2g. InstallShield detected via _isuninst.exe'
  );
  const isApp = {
    ...innoApp,
    id: 'test-is',
    name: 'InstallShield Test App',
    uninstallString: 'C:\\App\\_isuninst.exe',
  };
  const isCmd = buildUninstallCommand(isApp, { fileExists: () => true });
  assert(
    isCmd.type === 'installshield' && isCmd.args.includes('/s') && isCmd.isSilent === true,
    '2g. InstallShield appends /s flag'
  );

  // 2h. Wise Installer detection & flag /s
  assert(
    detectUninstallerType('C:\\App\\unwise.exe') === 'wise',
    '2h. Wise Installer detected via unwise.exe'
  );
  const wiseApp = {
    ...innoApp,
    id: 'test-wise',
    name: 'Wise Test App',
    uninstallString: 'C:\\App\\unwise.exe',
  };
  const wiseCmd = buildUninstallCommand(wiseApp, { fileExists: () => true });
  assert(
    wiseCmd.type === 'wise' && wiseCmd.args.includes('/s') && wiseCmd.isSilent === true,
    '2h. Wise Installer appends /s flag'
  );

  // 2i. Unknown uninstaller runs interactively with no silent flag added (D-AR-3, D-AR-5)
  const unknownApp = {
    ...innoApp,
    id: 'test-custom',
    name: 'Custom Uninstaller',
    uninstallString: 'C:\\App\\custom_remover.exe --mode=full',
  };
  const unknownCmd = buildUninstallCommand(unknownApp, { fileExists: () => true });
  assert(
    unknownCmd.type === 'unknown' &&
      unknownCmd.isSilent === false &&
      unknownCmd.isInteractive === true &&
      unknownCmd.args.join(' ') === '--mode=full',
    '2i. Unknown uninstaller runs interactively with original flags preserved'
  );

  // 2j. MSI command construction is always msiexec.exe /x {code} /qn (D-AR-2)
  const msiApp = {
    ...innoApp,
    id: '{11111111-2222-3333-4444-555555555555}',
    productCode: '{11111111-2222-3333-4444-555555555555}',
    isMsi: true,
    uninstallMethod: 'msi',
    uninstallString: 'MsiExec.exe /I{11111111-2222-3333-4444-555555555555}',
  };
  const msiCmd = buildUninstallCommand(msiApp);
  assert(
    msiCmd.executable === 'msiexec.exe' &&
      msiCmd.args[0] === '/x' &&
      msiCmd.args[1] === '{11111111-2222-3333-4444-555555555555}' &&
      msiCmd.args[2] === '/qn' &&
      msiCmd.isSilent === true,
    '2j. MSI command constructed cleanly as msiexec.exe /x {code} /qn'
  );

  // 2k. Manufacturer-provided QuietUninstallString used directly
  const quietApp = {
    ...innoApp,
    id: 'test-quiet',
    uninstallString: 'C:\\App\\setup.exe',
    quietUninstallString: 'C:\\App\\setup.exe /quiet /norestart',
  };
  const quietCmd = buildUninstallCommand(quietApp, { fileExists: () => true });
  assert(
    quietCmd.isSilent === true &&
      quietCmd.commandLine === 'C:\\App\\setup.exe /quiet /norestart',
    '2k. Manufacturer-provided QuietUninstallString used directly with isSilent true'
  );

  console.log('\n=== Section 3: Enumeration Filtering & Mapping (Step 1, D-AR-1) ===\n');

  // 3a. SystemComponent = 1 excluded
  assert(isSystemComponentEntry(1) === true, '3a. SystemComponent numeric 1 recognized');
  assert(isSystemComponentEntry('1') === true, '3a. SystemComponent string "1" recognized');
  assert(isSystemComponentEntry(0) === false, '3a. SystemComponent 0 is not excluded');

  const sysCompEntry = {
    subKey: 'SysApp',
    hive: 'HKLM',
    registryKey: 'HKLM\\...\\SysApp',
    DisplayName: 'System Driver Helper',
    SystemComponent: 1,
  };
  assert(
    filterAndMapRegistryEntry(sysCompEntry) === null,
    '3b. Entry with SystemComponent = 1 is excluded from results'
  );

  // 3c. ParentKeyName present excluded (updates/patches)
  assert(isParentKeyPresent('KB5001234') === true, '3c. ParentKeyName string recognized');
  assert(isParentKeyPresent('') === false, '3c. Empty ParentKeyName not excluded');

  const patchEntry = {
    subKey: 'KB5001234',
    hive: 'HKLM',
    registryKey: 'HKLM\\...\\KB5001234',
    DisplayName: 'Security Update KB5001234',
    ParentKeyName: 'MainApp',
  };
  assert(
    filterAndMapRegistryEntry(patchEntry) === null,
    '3d. Entry with ParentKeyName is excluded from results'
  );

  // 3e. Missing DisplayName excluded
  const internalEntry = {
    subKey: 'Internal123',
    hive: 'HKLM',
    registryKey: 'HKLM\\...\\Internal123',
    DisplayName: '',
  };
  assert(
    filterAndMapRegistryEntry(internalEntry) === null,
    '3e. Entry with empty DisplayName is excluded'
  );

  // 3f. Valid application mapped accurately
  const validEntry = {
    subKey: 'DeskKlean',
    hive: 'HKLM',
    registryKey: 'SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\DeskKlean',
    DisplayName: 'DeskKlean System Cleaner',
    DisplayVersion: '1.2.0',
    Publisher: 'DeskKlean Team',
    InstallDate: '20240315',
    EstimatedSize: 51200, // 50 MB in KB
    InstallLocation: 'C:\\Program Files\\DeskKlean',
    UninstallString: '"C:\\Program Files\\DeskKlean\\Uninstall.exe"',
  };
  const mapped = filterAndMapRegistryEntry(validEntry, { fileExists: () => true });
  assert(
    mapped !== null &&
      mapped.name === 'DeskKlean System Cleaner' &&
      mapped.version === '1.2.0' &&
      mapped.publisher === 'DeskKlean Team' &&
      mapped.installDate === '2024-03-15' &&
      mapped.sizeBytes === 51200 * 1024 &&
      mapped.leftoversDetected === null &&
      mapped.isSystemComponent === false,
    '3f. Valid application fields mapped and converted accurately'
  );

  // 3g. EstimatedSize conversion (KB to bytes) and null preservation
  assert(convertEstimatedSize(1024) === 1048576, '3g. 1024 KB converts to 1,048,576 bytes');
  assert(convertEstimatedSize('2048') === 2097152, '3g. String "2048" converts to 2,097,152 bytes');
  assert(convertEstimatedSize(0) === null, '3g. Zero size converts to null (never guessed)');
  assert(convertEstimatedSize(null) === null, '3g. Absent size converts to null');

  // 3h. Date normalization
  assert(normalizeInstallDate('20240105') === '2024-01-05', '3h. 20240105 normalizes to 2024-01-05');
  assert(normalizeInstallDate('2024-02-28') === '2024-02-28', '3h. Already ISO date preserved');
  assert(normalizeInstallDate('') === '', '3h. Empty date returns empty string');

  console.log('\n=== Section 4: Uninstall-Method Classification (Step 1, D-AR-1, D-AR-7, D-AR-8) ===\n');

  // 4a. MSI via PSComponentID GUID
  const { productCode: code1, isMsi: isMsi1 } = resolveProductCode(
    'SomeKey',
    'B627197A-DB71-4628-98CA-0988ED7715DA'
  );
  assert(
    isMsi1 === true && code1 === '{B627197A-DB71-4628-98CA-0988ED7715DA}',
    '4a. MSI product code resolved from PSComponentID'
  );

  // 4b. MSI via subKey GUID in braces
  const { productCode: code2, isMsi: isMsi2 } = resolveProductCode(
    '{B627197A-DB71-4628-98CA-0988ED7715DA}',
    undefined
  );
  assert(
    isMsi2 === true && code2 === '{B627197A-DB71-4628-98CA-0988ED7715DA}',
    '4b. MSI product code resolved from braced GUID subKey'
  );

  // 4c. Non-MSI with existing target file -> uninstall-string
  const existingUninst = filterAndMapRegistryEntry(
    {
      subKey: 'MyTool',
      hive: 'HKCU',
      registryKey: 'HKCU\\...\\MyTool',
      DisplayName: 'My Tool',
      UninstallString: 'C:\\Tools\\unins000.exe',
    },
    { fileExists: () => true }
  );
  assert(
    existingUninst?.uninstallMethod === 'uninstall-string',
    '4c. Existing uninstaller maps to uninstallMethod "uninstall-string"'
  );

  // 4d. Non-MSI with missing target file -> unavailable (D-AR-7)
  const missingUninst = filterAndMapRegistryEntry(
    {
      subKey: 'OldTool',
      hive: 'HKCU',
      registryKey: 'HKCU\\...\\OldTool',
      DisplayName: 'Old Dead Tool',
      UninstallString: 'C:\\NonExistent\\unins000.exe',
    },
    { fileExists: () => false }
  );
  assert(
    missingUninst?.uninstallMethod === 'unavailable',
    '4d. Missing uninstaller target maps to uninstallMethod "unavailable" (D-AR-7)'
  );

  // 4e. Store app mapping
  const storeMapped = filterAndMapStoreEntry({
    Name: 'Microsoft.WindowsTerminal',
    PackageFullName: 'Microsoft.WindowsTerminal_1.19.10573.0_x64__8wekyb3d8bbwe',
    PackageFamilyName: 'Microsoft.WindowsTerminal_8wekyb3d8bbwe',
    Version: '1.19.10573.0',
    Publisher: 'CN=Microsoft Corporation',
    NonRemovable: false,
  });
  assert(
    storeMapped !== null &&
      storeMapped.isStoreApp === true &&
      storeMapped.uninstallMethod === 'store' &&
      storeMapped.id === 'Microsoft.WindowsTerminal_1.19.10573.0_x64__8wekyb3d8bbwe',
    '4e. Store app mapped with uninstallMethod "store"'
  );

  // 4f. Protected Store app detected as non-removable
  const sysStoreApp = filterAndMapStoreEntry({
    Name: 'Microsoft.Windows.Cortana',
    PackageFullName: 'Microsoft.Windows.Cortana_1.0_x64__8wekyb3d8bbwe',
    NonRemovable: true,
  });
  assert(
    sysStoreApp?.nonRemovable === true,
    '4f. Protected Store app identified as nonRemovable (D-AR-8)'
  );

  console.log('\n=== Section 5: Process-Tree Wait Strategy (OQ-AR-4) ===\n');

  // 5a. Primary process exits immediately while child continues running
  // Timeline:
  // t0: Root (PID 100) running, spawns Child (PID 200)
  // t1: Root (PID 100) exits, Child (PID 200) running
  // t2: Child (PID 200) exits
  let ticks = 0;
  const mockSnapshot = async () => {
    ticks++;
    if (ticks === 1) {
      return [
        { pid: 100, ppid: 1, isAlive: true },
        { pid: 200, ppid: 100, isAlive: true },
      ];
    }
    if (ticks === 2) {
      // Root died! Child still running. Primary-only wait would have erroneously stopped here!
      return [
        { pid: 200, ppid: 100, isAlive: true },
      ];
    }
    // All dead
    return [];
  };

  const treeResult = await waitForProcessTree(100, {
    timeoutMs: 5000,
    pollIntervalMs: 10,
    getProcessSnapshot: mockSnapshot,
  });

  assert(
    treeResult.timedOut === false &&
      treeResult.allPids.includes(100) &&
      treeResult.allPids.includes(200),
    '5a. Process tree wait waits for spawned child after root process exits'
  );

  // 5b. Grandchild process handling
  // Root (300) -> Child (301) -> Grandchild (302)
  let deepTicks = 0;
  const mockDeepSnapshot = async () => {
    deepTicks++;
    if (deepTicks === 1) {
      return [
        { pid: 300, ppid: 1, isAlive: true },
        { pid: 301, ppid: 300, isAlive: true },
      ];
    }
    if (deepTicks === 2) {
      // Child spawns grandchild, root & child exit
      return [
        { pid: 302, ppid: 301, isAlive: true },
      ];
    }
    return [];
  };

  const deepResult = await waitForProcessTree(300, {
    timeoutMs: 5000,
    pollIntervalMs: 10,
    getProcessSnapshot: mockDeepSnapshot,
  });

  assert(
    deepResult.timedOut === false &&
      deepResult.allPids.includes(300) &&
      deepResult.allPids.includes(301) &&
      deepResult.allPids.includes(302),
    '5b. Multi-generation process tree wait discovers and tracks grandchild processes'
  );

  // 5c. Timeout handling
  const mockHungSnapshot = async () => [
    { pid: 400, ppid: 1, isAlive: true },
    { pid: 401, ppid: 400, isAlive: true },
  ];
  const hungResult = await waitForProcessTree(400, {
    timeoutMs: 50,
    pollIntervalMs: 10,
    getProcessSnapshot: mockHungSnapshot,
  });
  assert(
    hungResult.timedOut === true,
    '5c. Hung process tree properly times out after deadline'
  );

  console.log('\n=== Section 6: Re-enumeration Verification Logic (D-AR-4, Binding Rail 1) ===\n');

  // 6a. Product successfully gone from re-enumerated list -> removed: true
  const listAfterUninstall = [
    { id: 'AppA', name: 'App A', productCode: null },
    { id: 'AppB', name: 'App B', productCode: null },
  ];
  const v1 = verifyAppRemoved('AppC', listAfterUninstall, null);
  assert(v1.removed === true, '6a. Product absent from re-enumeration verified as removed');

  // 6b. Product still present in re-enumeration -> removed: false
  const listWithAppC = [
    { id: 'AppA', name: 'App A', productCode: null },
    { id: 'AppC', name: 'App C', productCode: null },
  ];
  const v2 = verifyAppRemoved('AppC', listWithAppC, null);
  assert(v2.removed === false, '6b. Product still registered in re-enumeration fails verification');

  // 6c. Verification checks productCode if ID key name differs
  const listWithMsi = [
    { id: 'DifferentKeyName', name: 'App Msi', productCode: '{AAAA-BBBB-CCCC}' },
  ];
  const v3 = verifyAppRemoved('AppMsiKey', listWithMsi, '{AAAA-BBBB-CCCC}');
  assert(
    v3.removed === false,
    '6c. Re-enumeration matches productCode even if subKey differs'
  );

  // 6d. Case-insensitive matching for product codes
  const listCase = [
    { id: 'AppLower', name: 'App Lower', productCode: '{b627197a-db71-4628-98ca-0988ed7715da}' },
  ];
  const v4 = verifyAppRemoved('any-id', listCase, '{B627197A-DB71-4628-98CA-0988ED7715DA}');
  assert(
    v4.removed === false,
    '6d. ProductCode verification is case-insensitive'
  );

  console.log('\n=== Section 7: Reboot-Pending Detection (D-AR-6) ===\n');

  // 7a. PendingFileRenameOperations returns true -> reboot pending
  const mockPsRebootPending = async () => 'true';
  const rebootCheck1 = await checkPendingReboot({ runPowerShellFn: mockPsRebootPending });
  assert(rebootCheck1 === true, '7a. Detects PendingFileRenameOperations present in registry');

  // 7b. PendingFileRenameOperations returns false -> no reboot
  const mockPsRebootNone = async () => 'false';
  const rebootCheck2 = await checkPendingReboot({ runPowerShellFn: mockPsRebootNone });
  assert(rebootCheck2 === false, '7b. Confirms no reboot pending when value absent');

  console.log('\n=== Section 8: Irreversibility & Framework Plan (D-AR-9, Binding Rail 2) ===\n');

  // 8a. Plan declares reversibility: 'irreversible'
  const appToPlan = {
    id: 'test-app',
    name: 'Sample App',
    publisher: 'Publisher',
    version: '2.0',
    installDate: '2024-01-01',
    sizeBytes: 2048000,
    installLocation: 'C:\\App',
    uninstallString: '"C:\\App\\unins000.exe"',
    quietUninstallString: null,
    productCode: null,
    isMsi: false,
    isStoreApp: false,
    uninstallMethod: 'uninstall-string',
    leftoversDetected: null,
  };
  const plan = createAppUninstallPlan(appToPlan, { fileExists: () => true });

  assert(plan.reversibility === 'irreversible', '8a. Plan declares reversibility "irreversible"');
  assert(
    plan.irreversibilityReason === D_AR_9_IRREVERSIBILITY_REASON,
    '8b. Plan carries verbatim D-AR-9 irreversibility reason'
  );
  assert(plan.requiresElevation === true, '8c. Plan requires administrator elevation');
  assert(plan.actions.length === 1 && plan.actions[0].kind === 'uninstall', '8d. Plan contains 1 uninstall action');
  assert(plan.actions[0].reclaimableBytes === 2048000, '8e. Plan carries estimated size for reclaimableBytes');

  // 8f. Missing uninstaller produces blocked action (D-AR-7)
  const deadApp = {
    ...appToPlan,
    id: 'dead-app',
    uninstallMethod: 'unavailable',
  };
  const blockedPlan = createAppUninstallPlan(deadApp);
  assert(
    blockedPlan.actions.length === 0 &&
      blockedPlan.blocked.length === 1 &&
      blockedPlan.blocked[0].reason.includes('installer not found'),
    '8f. Missing installer target produces blocked plan (D-AR-7)'
  );

  // 8g. Protected system package produces blocked action (D-AR-8)
  const protectedApp = {
    ...appToPlan,
    id: 'sys-pkg',
    isStoreApp: true,
    uninstallMethod: 'store',
    nonRemovable: true,
  };
  const sysPlan = createAppUninstallPlan(protectedApp);
  assert(
    sysPlan.actions.length === 0 &&
      sysPlan.blocked.length === 1 &&
      sysPlan.blocked[0].reason.includes('Protected Windows system package'),
    '8g. Protected system package produces blocked plan'
  );

  // 8h. "Remove registry entry only" plan (Binding Rail 5)
  const regEntryPlan = createRemoveAppRegistryEntryPlan({
    ...appToPlan,
    registryKey: 'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\test-app',
    hive: 'HKCU',
  });
  assert(
    regEntryPlan.actions[0].kind === 'registry-key' &&
      regEntryPlan.actions[0].description.includes('Application remains installed on the machine'),
    '8h. Remove registry entry plan plainly states application remains installed (Binding Rail 5)'
  );

  // 8i. Irreversible plan without reason throws (Phase 3 contract rail)
  let threwNoReason = false;
  try {
    createOperationPlan({
      module: 'app-remover',
      actions: [],
      blocked: [],
      reversibility: 'irreversible',
      requiresElevation: true,
    });
  } catch (err) {
    threwNoReason = true;
  }
  assert(
    threwNoReason === true,
    '8i. Irreversible plan without irreversibilityReason throws contract violation error'
  );

  console.log('\n=== Section 9: Framework Execution Pipeline End-to-End ===\n');

  const tmpBackupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dk-app-test-'));

  // 9a. Successful uninstallation verified by re-enumeration
  const planA = createAppUninstallPlan(appToPlan, { fileExists: () => true });
  let reEnumCalls = 0;
  const mockRunnersSuccess = {
    isWindowsFn: () => true,
    isElevatedFn: async () => true,
    backupDirOverride: tmpBackupDir,
    fileExistsFn: () => true,
    spawnProcessFn: async () => ({ pid: 9001 }),
    waitForProcessTreeFn: async () => ({ timedOut: false, allPids: [9001] }),
    reEnumerateFn: async () => {
      reEnumCalls++;
      // Return list without test-app -> verified gone!
      return [];
    },
    checkPendingRebootFn: async () => false,
  };

  const execRes1 = await executeUninstallActions(planA, undefined, mockRunnersSuccess);
  assert(
    execRes1.success === true &&
      execRes1.completed === 1 &&
      execRes1.failed === 0 &&
      reEnumCalls === 1,
    '9a. Execution reports success only after re-enumeration confirms product is gone'
  );
  assert(
    fs.existsSync(execRes1.backupPath),
    '9b. Safety backup manifest created on disk before uninstallation'
  );

  // 9c. Uninstaller exits but product is still registered -> FAILURE reported (NEVER fake success!)
  const planB = createAppUninstallPlan(appToPlan, { fileExists: () => true });
  const mockRunnersStillPresent = {
    isWindowsFn: () => true,
    isElevatedFn: async () => true,
    backupDirOverride: tmpBackupDir,
    fileExistsFn: () => true,
    spawnProcessFn: async () => ({ pid: 9002 }),
    waitForProcessTreeFn: async () => ({ timedOut: false, allPids: [9002] }),
    reEnumerateFn: async () => [appToPlan], // Still in list!
    checkPendingRebootFn: async () => false,
  };

  const execRes2 = await executeUninstallActions(planB, undefined, mockRunnersStillPresent);
  assert(
    execRes2.success === false &&
      execRes2.completed === 0 &&
      execRes2.failed === 1 &&
      execRes2.failures[0].error.includes('uninstaller exited but the product is still registered'),
    '9c. Re-enumeration failure reports failure even if uninstaller process exited cleanly (Binding Rail 1)'
  );

  // 9d. Product still registered but reboot pending -> reports reboot required, NOT success
  const planC = createAppUninstallPlan(appToPlan, { fileExists: () => true });
  const mockRunnersRebootPending = {
    isWindowsFn: () => true,
    isElevatedFn: async () => true,
    backupDirOverride: tmpBackupDir,
    fileExistsFn: () => true,
    spawnProcessFn: async () => ({ pid: 9003 }),
    waitForProcessTreeFn: async () => ({ timedOut: false, allPids: [9003] }),
    reEnumerateFn: async () => [appToPlan],
    checkPendingRebootFn: async () => true, // Reboot pending!
  };

  const execRes3 = await executeUninstallActions(planC, undefined, mockRunnersRebootPending);
  assert(
    execRes3.success === false &&
      execRes3.failures[0].error.includes('Uninstall will complete after a reboot'),
    '9d. Pending reboot reports reboot notice and does NOT claim success (D-AR-6)'
  );

  // 9e. Pre-flight check: missing uninstaller target caught before launch (D-AR-7)
  const deadTargetApp = {
    ...appToPlan,
    id: 'missing-exe-app',
    uninstallString: 'C:\\NonExistentPath\\uninstaller.exe',
  };
  const planD = createOperationPlan({
    module: 'app-remover',
    actions: [
      {
        id: 'uninstall-missing',
        kind: 'uninstall',
        target: 'C:\\NonExistentPath\\uninstaller.exe',
        description: 'Uninstall Missing App',
        reclaimableBytes: 1000,
        metadata: {
          appId: 'missing-exe-app',
          executable: 'C:\\NonExistentPath\\uninstaller.exe',
          isStoreApp: false,
          isMsi: false,
        },
      },
    ],
    reversibility: 'irreversible',
    irreversibilityReason: D_AR_9_IRREVERSIBILITY_REASON,
    requiresElevation: true,
  });

  let spawnedCalled = false;
  const mockRunnersMissing = {
    isWindowsFn: () => true,
    isElevatedFn: async () => true,
    backupDirOverride: tmpBackupDir,
    spawnProcessFn: async () => {
      spawnedCalled = true;
      return { pid: 9004 };
    },
  };

  const execRes4 = await executeUninstallActions(planD, undefined, mockRunnersMissing);
  assert(
    execRes4.success === false &&
      spawnedCalled === false &&
      execRes4.failures[0].error.includes('installer not found'),
    '9e. Missing UninstallString target file refused before launch without spawning (D-AR-7)'
  );

  // Clean up test temp dir
  fs.rmSync(tmpBackupDir, { recursive: true, force: true });

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
