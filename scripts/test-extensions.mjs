// scripts/test-extensions.mjs
// Pure-logic unit tests for Phase 13 Extension Manager.
// Verifies all 7 spec amendments and core requirements on Linux without requiring Electron.

import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import os from 'os';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

let extensionsModule;

try {
  extensionsModule = require('../dist/main/system/extensions.js');
} catch {
  const { execSync } = require('child_process');
  execSync('npm run build:main', { cwd: path.resolve(__dirname, '..'), stdio: 'inherit' });
  extensionsModule = require('../dist/main/system/extensions.js');
}

const {
  convertInstallTime,
  calculateRiskLevel,
  resolveExtensionName,
  parseChromiumPreferences,
  parseFirefoxExtensionsJson,
  findChromiumProfiles,
  findFirefoxProfiles,
  scanChromiumProfile,
  scanFirefoxProfile,
  scanChromiumBrowser,
  scanFirefoxBrowser,
  scanAllBrowsers,
  getExtensions,
  rescanExtensions,
  clearExtensionsCache,
  openExtensionPage,
  isBrowserInstalled,
} = extensionsModule;

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
  console.log('=== Section 1: install_time Conversion (Amendment 2) ===\n');

  // Amendment 2: Chromium's install_time is microseconds/FILETIME since 1601-01-01 UTC, not ms since 1970.
  // Must produce a plausible modern date, NOT 1601.
  const sampleInstallTimeNum = 133000000000000000n;
  const sampleInstallTimeStr = '133000000000000000';

  const convertedDateStr = convertInstallTime(sampleInstallTimeStr);
  assert(convertedDateStr !== null, '1a. convertInstallTime returns a non-null date string');

  const convertedDate = new Date(convertedDateStr);
  const year = convertedDate.getUTCFullYear();
  assert(year >= 2020 && year <= 2030, `1b. install_time yields modern date (${year}), NOT 1601`, `Got: ${year}`);
  assert(year !== 1601, '1c. Year is definitely not 1601 (unconverted raw FILETIME prevented)');

  // Verify that passing unconverted raw number to new Date produces wrong year (6185 or 1601)
  const rawDate = new Date(Number(sampleInstallTimeNum));
  assert(rawDate.getUTCFullYear() !== year, '1d. Raw Date constructor without conversion produces incorrect date');

  // 17-digit microsecond timestamp from actual Chromium (base::Time)
  const realChromeMicroseconds = '13340000000000000';
  const realDateStr = convertInstallTime(realChromeMicroseconds);
  assert(realDateStr !== null, '1e. 17-digit Chromium microsecond timestamp converts cleanly');
  const realYear = new Date(realDateStr).getUTCFullYear();
  assert(realYear === 2023, `1f. 17-digit timestamp converts to 2023 (got ${realYear})`);

  // Null, undefined, empty, invalid tolerance
  assert(convertInstallTime(null) === null, '1g. Null install_time returns null');
  assert(convertInstallTime(undefined) === null, '1h. Undefined install_time returns null');
  assert(convertInstallTime('') === null, '1i. Empty install_time returns null');
  assert(convertInstallTime('not_a_number') === null, '1j. Malformed string returns null without throwing');

  console.log('\n=== Section 2: Chromium Preferences Parser & Schema Tolerance ===\n');

  const sampleChromiumPreferences = {
    extensions: {
      settings: {
        cjpalhdlnbpafiamejdnhcphjbkeiagm: {
          state: 1,
          manifest: {
            name: 'uBlock Origin',
            version: '1.56.0',
            description: 'An efficient blocker. Easy on CPU and memory.',
            permissions: ['webRequest', 'webRequestBlocking', 'storage', '<all_urls>'],
          },
          install_time: '133000000000000000',
          path: 'Default/Extensions/cjpalhdlnbpafiamejdnhcphjbkeiagm',
        },
        nngceckbapebfimnlniiiahkandclblb: {
          state: 0,
          manifest: {
            name: 'Bitwarden - Free Password Manager',
            version: '2024.2.1',
            description: 'A secure and free password manager.',
            permissions: ['storage', 'clipboardWrite'],
          },
          install_time: '13340000000000000',
        },
      },
    },
  };

  const parsedChrome = parseChromiumPreferences(sampleChromiumPreferences, { browser: 'chrome' });
  assert(parsedChrome.extensions.length === 2, '2a. Parses 2 extensions from Preferences schema');
  assert(parsedChrome.extensions[0].name === 'uBlock Origin', '2b. Extracts display name correctly');
  assert(parsedChrome.extensions[0].version === '1.56.0', '2c. Extracts version string correctly');
  assert(parsedChrome.extensions[0].enabled === true, '2d. state 1 maps to enabled: true');
  assert(parsedChrome.extensions[0].riskLevel === 'high', '2e. <all_urls> correctly flags high risk');
  assert(parsedChrome.extensions[0].installDate !== null, '2f. Converted installDate is present');
  assert(new Date(parsedChrome.extensions[0].installDate).getUTCFullYear() === 2022, '2g. installDate year is 2022');
  assert(parsedChrome.extensions[1].enabled === false, '2h. state 0 maps to enabled: false');
  assert(parsedChrome.extensions[1].riskLevel === 'moderate', '2i. clipboardWrite flags moderate risk');

  // Schema tolerance: missing fields degrade to null, never throw
  const corruptChromium = {
    extensions: {
      settings: {
        sparse_extension: {
          // completely missing state, manifest, install_time
        },
      },
    },
  };
  const sparseResult = parseChromiumPreferences(corruptChromium);
  assert(sparseResult.extensions.length === 1, '2j. Missing fields tolerate sparse entry');
  assert(sparseResult.extensions[0].name === 'sparse_extension', '2k. Missing name falls back to extension id');
  assert(sparseResult.extensions[0].enabled === null, '2l. Missing state produces enabled: null');
  assert(sparseResult.extensions[0].installDate === null, '2m. Missing install_time produces null');

  // Missing extensions or settings object
  const emptyPrefs = parseChromiumPreferences({});
  assert(emptyPrefs.extensions.length === 0, '2n. Missing extensions key returns empty array without throwing');

  // Placeholder name resolution
  const tempExtDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deskklean-test-locales-'));
  const localeDir = path.join(tempExtDir, '_locales', 'en');
  fs.mkdirSync(localeDir, { recursive: true });
  fs.writeFileSync(
    path.join(localeDir, 'messages.json'),
    JSON.stringify({ appName: { message: 'Real Localized Name' } })
  );

  const resolvedName = resolveExtensionName('__MSG_appName__', tempExtDir, 'en');
  assert(resolvedName === 'Real Localized Name', '2o. Localized __MSG_appName__ resolved from messages.json');

  const fallbackName = resolveExtensionName('__MSG_missingKey__', tempExtDir, 'en');
  assert(fallbackName === '__MSG_missingKey__', '2p. Missing key falls back to placeholder, never invents a name');

  const unresolvableName = resolveExtensionName('__MSG_appName__', '/non/existent/path', 'en');
  assert(unresolvableName === '__MSG_appName__', '2q. Unreadable directory falls back to placeholder');

  // Cleanup temp dir
  fs.rmSync(tempExtDir, { recursive: true, force: true });

  console.log('\n=== Section 3: state Mapping (Amendment 5) ===\n');

  // Amendment 5: state: 1 -> enabled: true; state: 0 -> enabled: false; state missing -> enabled: null
  // Absent is NOT disabled — never report false for absent key.
  const stateTestCases = [
    { input: { extensions: { settings: { a: { state: 1 } } } }, expected: true, label: 'state 1 -> true' },
    { input: { extensions: { settings: { a: { state: 0 } } } }, expected: false, label: 'state 0 -> false' },
    { input: { extensions: { settings: { a: {} } } }, expected: null, label: 'missing state -> null (not false!)' },
    { input: { extensions: { settings: { a: { state: null } } } }, expected: null, label: 'null state -> null' },
  ];

  for (const tc of stateTestCases) {
    const res = parseChromiumPreferences(tc.input);
    assert(res.extensions[0].enabled === tc.expected, `3a. Chromium ${tc.label}`);
  }

  // Firefox active mapping: active: true -> true; active: false -> false; active missing -> null
  const ffActiveCases = [
    { input: { addons: [{ id: 'a', active: true }] }, expected: true, label: 'active true -> true' },
    { input: { addons: [{ id: 'a', active: false }] }, expected: false, label: 'active false -> false' },
    { input: { addons: [{ id: 'a' }] }, expected: null, label: 'missing active -> null (not false!)' },
    { input: { addons: [{ id: 'a', active: null }] }, expected: null, label: 'null active -> null' },
  ];

  for (const tc of ffActiveCases) {
    const res = parseFirefoxExtensionsJson(tc.input);
    assert(res.extensions[0].enabled === tc.expected, `3b. Firefox ${tc.label}`);
  }

  console.log('\n=== Section 4: Firefox Parser & addons Wrapper (Amendment 6) ===\n');

  // Amendment 6: extensions.json nests the array under the addons key: { "addons": [ ... ] }
  // A parser that reads root directly returns empty.
  const sampleFirefoxJson = {
    addons: [
      {
        id: 'uBlock0@raymondhill.net',
        name: 'uBlock Origin',
        version: '1.56.0',
        active: true,
        installDate: 1695526400000,
        description: 'An efficient blocker.',
        permissions: ['tabs', 'storage'],
      },
      {
        id: 'theme@mozilla.org',
        name: { default: 'Dark Theme' },
        version: '1.2',
        // active missing
      },
    ],
  };

  const parsedFirefox = parseFirefoxExtensionsJson(sampleFirefoxJson);
  assert(parsedFirefox.extensions.length === 2, '4a. Reads addons wrapper explicitly and finds 2 items');
  assert(parsedFirefox.extensions[0].id === 'uBlock0@raymondhill.net', '4b. Correct addon id');
  assert(parsedFirefox.extensions[0].name === 'uBlock Origin', '4c. Correct addon name');
  assert(parsedFirefox.extensions[0].enabled === true, '4d. active: true maps to enabled: true');
  assert(parsedFirefox.extensions[0].installDate !== null, '4e. Unix ms installDate parsed to ISO string');
  assert(parsedFirefox.extensions[1].name === 'Dark Theme', '4f. Localized object name resolved');
  assert(parsedFirefox.extensions[1].enabled === null, '4g. Missing active in theme maps to enabled: null');

  // Missing addons wrapper fails closed with error
  const missingAddonsWrapper = {
    uBlock0: { name: 'uBlock' },
  };
  const failWrapperResult = parseFirefoxExtensionsJson(missingAddonsWrapper);
  assert(failWrapperResult.extensions.length === 0, '4h. Root without addons returns 0 extensions');
  assert(typeof failWrapperResult.error === 'string', '4i. Missing addons wrapper returns explanatory error');

  console.log('\n=== Section 5: Multiple Profiles Enumeration (Amendment 4) ===\n');

  // Amendment 4: Enumerate Default AND every Profile * directory under User Data base that contains Preferences.
  // Reading only Default produces a partial list.
  const tempUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'deskklean-test-profiles-'));
  const defaultDir = path.join(tempUserData, 'Default');
  const profile1Dir = path.join(tempUserData, 'Profile 1');
  const profile2Dir = path.join(tempUserData, 'Profile 2');
  const emptyProfileDir = path.join(tempUserData, 'Profile 3'); // no Preferences

  fs.mkdirSync(defaultDir, { recursive: true });
  fs.mkdirSync(profile1Dir, { recursive: true });
  fs.mkdirSync(profile2Dir, { recursive: true });
  fs.mkdirSync(emptyProfileDir, { recursive: true });

  fs.writeFileSync(
    path.join(defaultDir, 'Preferences'),
    JSON.stringify({
      extensions: {
        settings: {
          ext_default: { state: 1, manifest: { name: 'Default Ext', version: '1.0' } },
        },
      },
    })
  );

  fs.writeFileSync(
    path.join(profile1Dir, 'Preferences'),
    JSON.stringify({
      extensions: {
        settings: {
          ext_profile1: { state: 1, manifest: { name: 'Profile 1 Ext', version: '2.0' } },
        },
      },
    })
  );

  fs.writeFileSync(
    path.join(profile2Dir, 'Preferences'),
    JSON.stringify({
      extensions: {
        settings: {
          ext_profile2: { state: 0, manifest: { name: 'Profile 2 Ext', version: '3.0' } },
        },
      },
    })
  );

  const discoveredProfiles = findChromiumProfiles(tempUserData);
  assert(discoveredProfiles.length === 3, '5a. Discovers exactly 3 profiles with Preferences files');
  assert(discoveredProfiles.some((p) => p.endsWith('Default')), '5b. Default profile discovered');
  assert(discoveredProfiles.some((p) => p.endsWith('Profile 1')), '5c. Profile 1 discovered');
  assert(discoveredProfiles.some((p) => p.endsWith('Profile 2')), '5d. Profile 2 discovered');
  assert(!discoveredProfiles.some((p) => p.endsWith('Profile 3')), '5e. Profile 3 without Preferences is excluded');

  // Scan browser across all profiles
  const multiProfileScan = await scanChromiumBrowser('chrome', tempUserData);
  assert(multiProfileScan.installed === true, '5f. Browser reported as installed');
  assert(multiProfileScan.available === true, '5g. Browser reported as available');
  assert(multiProfileScan.profileCount === 3, '5h. profileCount is 3');
  assert(multiProfileScan.extensions.length === 3, '5i. Merges extensions from ALL profiles (reading only Default would yield 1)');

  const ids = multiProfileScan.extensions.map((e) => e.id);
  assert(ids.includes('ext_default'), '5j. Contains extension from Default profile');
  assert(ids.includes('ext_profile1'), '5k. Contains extension from Profile 1');
  assert(ids.includes('ext_profile2'), '5l. Contains extension from Profile 2');

  // Clean up
  fs.rmSync(tempUserData, { recursive: true, force: true });

  console.log('\n=== Section 6: Firefox Profile Discovery ===\n');

  // Profiles under %APPDATA%\Mozilla\Firefox\Profiles\ with random suffixes
  const tempFfBase = fs.mkdtempSync(path.join(os.tmpdir(), 'deskklean-test-ff-'));
  const ffProfilesDir = path.join(tempFfBase, 'Profiles');
  const profA = path.join(ffProfilesDir, 'a1b2c3d4.default-release');
  const profB = path.join(ffProfilesDir, 'x9y8z7w6.dev-edition');

  fs.mkdirSync(profA, { recursive: true });
  fs.mkdirSync(profB, { recursive: true });

  fs.writeFileSync(
    path.join(profA, 'extensions.json'),
    JSON.stringify({
      addons: [{ id: 'addonA', name: 'Addon A', active: true }],
    })
  );

  fs.writeFileSync(
    path.join(profB, 'extensions.json'),
    JSON.stringify({
      addons: [{ id: 'addonB', name: 'Addon B', active: false }],
    })
  );

  const ffDiscovered = findFirefoxProfiles(tempFfBase);
  assert(ffDiscovered.length === 2, '6a. Discovers 2 random-suffix Firefox profiles dynamically');

  const ffScan = await scanFirefoxBrowser(tempFfBase);
  assert(ffScan.installed === true, '6b. Firefox reported installed');
  assert(ffScan.available === true, '6c. Firefox reported available');
  assert(ffScan.extensions.length === 2, '6d. Merged addons from both profiles');

  // Clean up
  fs.rmSync(tempFfBase, { recursive: true, force: true });

  console.log('\n=== Section 7: Unavailable Is Not Empty (Corrupt/Unreadable) ===\n');

  // Requirement: A browser whose Preferences cannot be read is reported as unavailable WITH A REASON,
  // never as an empty list. Fail closed on parse errors.
  const tempCorruptDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deskklean-test-corrupt-'));
  const corruptDefault = path.join(tempCorruptDir, 'Default');
  fs.mkdirSync(corruptDefault, { recursive: true });
  fs.writeFileSync(path.join(corruptDefault, 'Preferences'), '{ corrupt json !!!');

  const corruptProfileScan = scanChromiumProfile(corruptDefault, 'chrome');
  assert(corruptProfileScan.available === false, '7a. Corrupt Preferences yields available: false');
  assert(typeof corruptProfileScan.reason === 'string' && corruptProfileScan.reason.length > 0, '7b. Explanatory reason provided');
  assert(corruptProfileScan.reason.includes('Corrupt Preferences'), '7c. Reason identifies corrupt JSON');

  const corruptBrowserScan = await scanChromiumBrowser('chrome', tempCorruptDir);
  assert(corruptBrowserScan.available === false, '7d. Browser scan reports available: false on unparseable profile');
  assert(typeof corruptBrowserScan.reason === 'string', '7e. Browser level carries failure reason, NOT empty list');

  // Clean up
  fs.rmSync(tempCorruptDir, { recursive: true, force: true });

  console.log('\n=== Section 8: Browser Detection & Installed State ===\n');

  const mockRootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deskklean-test-detect-'));
  const mockChromeDir = path.join(mockRootDir, 'Chrome');
  const mockEdgeDir = path.join(mockRootDir, 'Edge');
  // Brave and Firefox not created -> not installed

  fs.mkdirSync(path.join(mockChromeDir, 'Default'), { recursive: true });
  fs.writeFileSync(
    path.join(mockChromeDir, 'Default', 'Preferences'),
    JSON.stringify({ extensions: { settings: {} } })
  );

  fs.mkdirSync(path.join(mockEdgeDir, 'Default'), { recursive: true });
  fs.writeFileSync(
    path.join(mockEdgeDir, 'Default', 'Preferences'),
    JSON.stringify({ extensions: { settings: {} } })
  );

  const mockBaseDirs = {
    chrome: mockChromeDir,
    edge: mockEdgeDir,
    brave: path.join(mockRootDir, 'Brave_NonExistent'),
    firefox: path.join(mockRootDir, 'Firefox_NonExistent'),
  };

  assert(isBrowserInstalled('chrome', mockBaseDirs) === true, '8a. Chrome detected as installed');
  assert(isBrowserInstalled('edge', mockBaseDirs) === true, '8b. Edge detected as installed');
  assert(isBrowserInstalled('brave', mockBaseDirs) === false, '8c. Brave detected as not installed');
  assert(isBrowserInstalled('firefox', mockBaseDirs) === false, '8d. Firefox detected as not installed');

  const fullScan = await scanAllBrowsers({ baseDirs: mockBaseDirs });
  assert(fullScan.browsers.chrome.installed === true, '8e. Chrome status marked installed');
  assert(fullScan.browsers.brave.installed === false, '8f. Brave status marked not installed');
  assert(fullScan.browsers.firefox.installed === false, '8g. Firefox status marked not installed');
  assert(typeof fullScan.scannedAt === 'string', '8h. Result carries scannedAt timestamp');

  console.log('\n=== Section 9: In-Memory Caching & Rescan (Amendment 7) ===\n');

  clearExtensionsCache();
  const scan1 = await getExtensions(false, { baseDirs: mockBaseDirs });
  const scan2 = await getExtensions(false, { baseDirs: mockBaseDirs });
  assert(scan1 === scan2, '9a. Subsequent getExtensions returns cached object reference');

  const rescanResult = await rescanExtensions({ baseDirs: mockBaseDirs });
  assert(rescanResult !== scan1, '9b. rescanExtensions discards cache and produces fresh object');

  console.log('\n=== Section 10: Deep Link Launching & Awaiting (Amendments 1 & 3) ===\n');

  // Amendment 3: Await the launch. shell.openExternal returns a Promise that rejects on failure.
  // The handler MUST await it and return { success: false, reason } on rejection. Never return success before settling.
  let openedUrl = '';
  const mockShellSuccess = async (url) => {
    openedUrl = url;
  };
  const mockShellFail = async () => {
    throw new Error('Shell protocol handler missing or failed');
  };

  // Test uninstalled browser returns failure immediately
  const uninstalledOpen = await openExtensionPage('brave', {
    customBaseDirs: mockBaseDirs,
    shellOpenExternal: mockShellSuccess,
  });
  assert(uninstalledOpen.success === false, '10a. Uninstalled browser refuses deep link');
  assert(uninstalledOpen.reason.includes('not installed'), '10b. Uninstalled reason explains why');

  // Test successful Chromium launch
  const chromeOpen = await openExtensionPage('chrome', {
    customBaseDirs: mockBaseDirs,
    shellOpenExternal: mockShellSuccess,
  });
  assert(chromeOpen.success === true, '10c. Chrome launch reports success');
  assert(openedUrl === 'chrome://extensions', '10d. Correct deep link URL used for Chrome');

  // Test failed Chromium launch awaits and reports failure
  const edgeFail = await openExtensionPage('edge', {
    customBaseDirs: mockBaseDirs,
    shellOpenExternal: mockShellFail,
  });
  assert(edgeFail.success === false, '10e. Rejection in shell.openExternal returns success: false');
  assert(edgeFail.reason.includes('Shell protocol handler missing'), '10f. Carries actual rejection message');

  // Amendment 1: Firefox deep link cannot use about:addons via shell.openExternal
  // When firefox.exe cannot be located, returns { success: false, reason }
  const ffMissingExe = await openExtensionPage('firefox', {
    customBaseDirs: { firefox: mockRootDir }, // directory exists so installed = true
  });
  assert(ffMissingExe.success === false, '10g. Firefox launch fails when firefox.exe cannot be found');
  assert(typeof ffMissingExe.reason === 'string', '10h. Explanatory reason returned for missing firefox.exe');

  // Test Firefox launch when executable is present and verify command line arguments
  let spawnedArgs = null;
  let spawnedExe = '';
  const mockSpawn = (exe, args) => {
    spawnedExe = exe;
    spawnedArgs = args;
    const { EventEmitter } = require('events');
    const emitter = new EventEmitter();
    emitter.unref = () => {};
    return emitter;
  };

  const tempExe = path.join(mockRootDir, 'firefox.exe');
  fs.writeFileSync(tempExe, '');

  const ffSuccessLaunch = await openExtensionPage('firefox', {
    customBaseDirs: { firefox: mockRootDir },
    firefoxExePath: tempExe,
    spawnFn: mockSpawn,
  });
  assert(ffSuccessLaunch.success === true, '10i. Firefox launch succeeds when executable located');
  assert(spawnedExe === tempExe, '10j. Spawns located firefox.exe executable');
  assert(
    Array.isArray(spawnedArgs) && spawnedArgs[0] === '-url' && spawnedArgs[1] === 'about:addons',
    '10k. Spawns with -url about:addons per Amendment 1'
  );

  // Clean up mockRootDir now that Section 10 is done
  fs.rmSync(mockRootDir, { recursive: true, force: true });

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
  console.error('Test execution failed:', err);
  process.exit(1);
});
