import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import {
  BrowserId,
  ExtensionItem,
  BrowserStatus,
  ExtensionScanResult,
  ExtensionOpenResult,
  ExtensionPermissionRisk,
} from '../../shared/types';

// Safe access to Electron shell to allow tests to run outside Electron environment
function getElectronShell(): { openExternal?: (url: string) => Promise<void> } | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const electron = require('electron');
    return electron.shell || null;
  } catch {
    return null;
  }
}

/**
 * Returns default base directories for each browser.
 * Respects Windows environment variables, or uses provided env / overrides.
 */
export function getBrowserBaseDirs(env: NodeJS.ProcessEnv = process.env): Record<BrowserId, string> {
  const localAppData = env.LOCALAPPDATA || path.join(env.USERPROFILE || '', 'AppData', 'Local');
  const appData = env.APPDATA || path.join(env.USERPROFILE || '', 'AppData', 'Roaming');

  return {
    chrome: path.join(localAppData, 'Google', 'Chrome', 'User Data'),
    edge: path.join(localAppData, 'Microsoft', 'Edge', 'User Data'),
    brave: path.join(localAppData, 'BraveSoftware', 'Brave-Browser', 'User Data'),
    firefox: path.join(appData, 'Mozilla', 'Firefox'),
  };
}

/**
 * Checks whether a browser is installed by checking for the existence of its base directory.
 */
export function isBrowserInstalled(
  browser: BrowserId,
  customBaseDirs?: Partial<Record<BrowserId, string>>
): boolean {
  const baseDirs = { ...getBrowserBaseDirs(), ...customBaseDirs };
  const baseDir = baseDirs[browser];
  if (!baseDir) return false;
  try {
    return fs.existsSync(baseDir);
  } catch {
    return false;
  }
}

/**
 * Converts Chromium's install_time to an ISO date string.
 *
 * Chromium stores install_time as a 64-bit integer based on the Windows FILETIME / WebKit
 * epoch (Jan 1, 1601 UTC).
 * 11,644,473,600,000 ms elapsed between 1601-01-01 and 1970-01-01.
 *
 * Handles both 18-digit (100-nanosecond intervals) and 17-digit (microsecond) formats.
 * E.g. install_time = 133000000000000000 -> 2022-06-18T04:26:40.000Z.
 * Missing or invalid timestamps produce null, never throwing.
 */
export function convertInstallTime(
  raw: string | number | bigint | null | undefined
): string | null {
  if (raw === null || raw === undefined || raw === '') return null;
  try {
    const rawStr = String(raw).trim();
    if (!rawStr) return null;
    const num = BigInt(rawStr.split('.')[0]);
    if (num <= 0n) return null;

    let unixMs: number;
    // Difference between 1601-01-01 and 1970-01-01 in milliseconds
    const epochDiffMs = 11644473600000;

    if (num > 100_000_000_000_000_000n) {
      // 18 digits (e.g. 133000000000000000): 100-nanosecond intervals
      unixMs = Number(num / 10000n) - epochDiffMs;
    } else if (num > 1_000_000_000_000_000n) {
      // 17 digits (e.g. 13340000000000000): microseconds since 1601
      unixMs = Number(num / 1000n) - epochDiffMs;
    } else if (num > 100_000_000_000n) {
      // Unix timestamp in milliseconds
      unixMs = Number(num);
    } else {
      // Unix timestamp in seconds
      unixMs = Number(num * 1000n);
    }

    const date = new Date(unixMs);
    if (isNaN(date.getTime())) return null;
    return date.toISOString();
  } catch {
    return null;
  }
}

/**
 * Calculates a sensible risk level based on extension permissions.
 */
export function calculateRiskLevel(permissions: string[]): ExtensionPermissionRisk {
  const highRiskPatterns = [
    '<all_urls>',
    '*://*/*',
    'http://*/*',
    'https://*/*',
    'webRequestBlocking',
    'cookies',
    'history',
    'management',
    'debugger',
    'nativeMessaging',
  ];

  const moderateRiskPatterns = [
    'webRequest',
    'tabs',
    'downloads',
    'clipboardRead',
    'clipboardWrite',
    'privacy',
    'proxy',
  ];

  if (permissions.some((p) => highRiskPatterns.includes(p))) {
    return 'high';
  }
  if (permissions.some((p) => moderateRiskPatterns.includes(p))) {
    return 'moderate';
  }
  return 'safe';
}

/**
 * Resolves localized extension names (e.g. __MSG_appName__).
 * If a message placeholder is present, attempts to read _locales/<locale>/messages.json.
 * Falls back to the placeholder string if unreadable. Never invents a name.
 */
export function resolveExtensionName(
  rawName: string | null | undefined,
  extensionDir?: string | null,
  defaultLocale?: string | null
): string | null {
  if (rawName === null || rawName === undefined) return null;
  if (typeof rawName !== 'string') return String(rawName);
  const trimmed = rawName.trim();
  if (!trimmed) return null;

  const placeholderMatch = trimmed.match(/^__MSG_([A-Za-z0-9_]+)__$/);
  if (!placeholderMatch) {
    return trimmed;
  }

  const msgKey = placeholderMatch[1];
  if (!extensionDir) {
    return trimmed;
  }

  const localesToTry = [defaultLocale, 'en_US', 'en', 'en_GB'].filter(Boolean) as string[];
  for (const loc of localesToTry) {
    const locPath = path.join(extensionDir, '_locales', loc, 'messages.json');
    try {
      if (fs.existsSync(locPath)) {
        const content = fs.readFileSync(locPath, 'utf8');
        const msgs = JSON.parse(content);
        if (msgs[msgKey] && typeof msgs[msgKey].message === 'string') {
          return msgs[msgKey].message;
        }
        const lowerKey = msgKey.toLowerCase();
        for (const k of Object.keys(msgs)) {
          if (k.toLowerCase() === lowerKey && typeof msgs[k]?.message === 'string') {
            return msgs[k].message;
          }
        }
      }
    } catch {
      // Fail closed to placeholder
    }
  }

  return trimmed;
}

/**
 * Parses a Chromium Preferences JSON string or object.
 * Adheres strictly to:
 * - Schema tolerance: missing fields degrade to null, never throw.
 * - state mapping: 1 -> true, 0 -> false, missing -> null (never report false for absent).
 * - install_time conversion.
 */
export function parseChromiumPreferences(
  contentOrObject: string | Record<string, any>,
  options?: {
    profilePath?: string;
    browser?: BrowserId;
  }
): { extensions: ExtensionItem[]; error?: string } {
  let data: Record<string, any>;
  if (typeof contentOrObject === 'string') {
    try {
      data = JSON.parse(contentOrObject);
    } catch (err: any) {
      return {
        extensions: [],
        error: `Corrupt Preferences JSON: ${err?.message || String(err)}`,
      };
    }
  } else {
    data = contentOrObject;
  }

  if (!data || typeof data !== 'object') {
    return {
      extensions: [],
      error: 'Preferences is not a valid JSON object',
    };
  }

  const extensionsObj = data.extensions;
  if (!extensionsObj || typeof extensionsObj !== 'object') {
    return { extensions: [] };
  }

  const settings = extensionsObj.settings;
  if (!settings || typeof settings !== 'object') {
    return { extensions: [] };
  }

  const result: ExtensionItem[] = [];
  const browser = options?.browser ?? 'chrome';
  const profilePath = options?.profilePath ?? '';

  for (const [id, rawEntry] of Object.entries(settings)) {
    if (!rawEntry || typeof rawEntry !== 'object') continue;
    const entry = rawEntry as Record<string, any>;

    // state mapping: 1 -> true, 0 -> false, missing -> null
    let enabled: boolean | null = null;
    if ('state' in entry && entry.state !== undefined && entry.state !== null) {
      if (entry.state === 1) enabled = true;
      else if (entry.state === 0) enabled = false;
      else if (typeof entry.state === 'boolean') enabled = entry.state;
      else enabled = null;
    }

    const manifest = entry.manifest && typeof entry.manifest === 'object' ? entry.manifest : null;
    const extDir =
      typeof entry.path === 'string'
        ? path.isAbsolute(entry.path)
          ? entry.path
          : path.join(profilePath, entry.path)
        : null;

    const rawName = manifest?.name ?? entry.name ?? null;
    const name = resolveExtensionName(rawName, extDir, manifest?.default_locale);
    const version = manifest?.version ?? entry.version ?? null;
    const description = manifest?.description ?? entry.description ?? null;
    const permissions: string[] = Array.isArray(manifest?.permissions)
      ? manifest.permissions.filter((p: any) => typeof p === 'string')
      : [];

    const rawInstallTime = entry.install_time ?? manifest?.install_time ?? null;
    const installDate = convertInstallTime(rawInstallTime);

    result.push({
      id,
      name: name ?? id,
      version: version ?? '',
      description: description ?? '',
      enabled,
      installDate,
      browser,
      profilePath,
      permissions,
      riskLevel: calculateRiskLevel(permissions),
    });
  }

  return { extensions: result };
}

/**
 * Parses Firefox's extensions.json string or object.
 * Explicitly reads data.addons wrapper array.
 * Adheres strictly to:
 * - Schema tolerance: missing fields produce null, never throw.
 * - active mapping: true -> true, false -> false, missing -> null.
 */
export function parseFirefoxExtensionsJson(
  contentOrObject: string | Record<string, any>,
  options?: {
    profilePath?: string;
  }
): { extensions: ExtensionItem[]; error?: string } {
  let data: Record<string, any>;
  if (typeof contentOrObject === 'string') {
    try {
      data = JSON.parse(contentOrObject);
    } catch (err: any) {
      return {
        extensions: [],
        error: `Corrupt extensions.json: ${err?.message || String(err)}`,
      };
    }
  } else {
    data = contentOrObject;
  }

  if (!data || typeof data !== 'object') {
    return {
      extensions: [],
      error: 'extensions.json is not a valid JSON object',
    };
  }

  // Spec amendment 6: Firefox addons wrapper
  // extensions.json nests the array under the addons key: { "addons": [ ... ] }
  if (!('addons' in data)) {
    return {
      extensions: [],
      error: 'extensions.json root missing "addons" wrapper array',
    };
  }

  if (!Array.isArray(data.addons)) {
    return {
      extensions: [],
      error: 'extensions.json "addons" property is not an array',
    };
  }

  const result: ExtensionItem[] = [];
  const profilePath = options?.profilePath ?? '';

  for (const rawAddon of data.addons) {
    if (!rawAddon || typeof rawAddon !== 'object') continue;
    const addon = rawAddon as Record<string, any>;

    // active mapping: true -> true, false -> false, missing -> null
    let enabled: boolean | null = null;
    if ('active' in addon && addon.active !== undefined && addon.active !== null) {
      if (addon.active === true || addon.active === 1) enabled = true;
      else if (addon.active === false || addon.active === 0) enabled = false;
      else enabled = null;
    }

    let name: string | null = null;
    if (typeof addon.name === 'string') {
      name = addon.name;
    } else if (addon.name && typeof addon.name === 'object') {
      name = addon.name.default ?? addon.name['en-US'] ?? Object.values(addon.name)[0] ?? null;
    }

    const id = addon.id ?? null;
    const version = addon.version ?? '';
    const description = typeof addon.description === 'string' ? addon.description : '';
    const permissions: string[] = Array.isArray(addon.permissions)
      ? addon.permissions.filter((p: any) => typeof p === 'string')
      : [];

    let installDate: string | null = null;
    if (addon.installDate) {
      if (typeof addon.installDate === 'number') {
        const d = new Date(addon.installDate);
        installDate = isNaN(d.getTime()) ? null : d.toISOString();
      } else {
        installDate = convertInstallTime(addon.installDate);
      }
    }

    result.push({
      id: id ?? 'unknown-id',
      name: name ?? id ?? 'Unnamed Extension',
      version: version ?? '',
      description: description ?? '',
      enabled,
      installDate,
      browser: 'firefox',
      profilePath,
      permissions,
      riskLevel: calculateRiskLevel(permissions),
    });
  }

  return { extensions: result };
}

/**
 * Discovers all profile directories for a Chromium browser.
 * Checks Default AND every directory matching Profile * containing a Preferences file.
 */
export function findChromiumProfiles(userDataDir: string): string[] {
  if (!fs.existsSync(userDataDir)) return [];
  const profiles: string[] = [];

  try {
    const defaultPref = path.join(userDataDir, 'Default', 'Preferences');
    if (fs.existsSync(defaultPref)) {
      profiles.push(path.join(userDataDir, 'Default'));
    }

    const entries = fs.readdirSync(userDataDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && /^Profile(\s+\d+)?$/i.test(entry.name)) {
        const profilePref = path.join(userDataDir, entry.name, 'Preferences');
        if (fs.existsSync(profilePref)) {
          profiles.push(path.join(userDataDir, entry.name));
        }
      }
    }
  } catch {
    // Tolerate directory read errors
  }

  return profiles;
}

/**
 * Discovers all profile directories for Firefox.
 * Profiles live under %APPDATA%\Mozilla\Firefox\Profiles\ with random suffixes.
 */
export function findFirefoxProfiles(firefoxBaseDir: string): string[] {
  if (!fs.existsSync(firefoxBaseDir)) return [];
  const profiles: string[] = [];

  const candidateDirs = [
    path.join(firefoxBaseDir, 'Profiles'),
    firefoxBaseDir,
  ];

  for (const base of candidateDirs) {
    if (!fs.existsSync(base)) continue;
    try {
      const entries = fs.readdirSync(base, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const extJson = path.join(base, entry.name, 'extensions.json');
          if (fs.existsSync(extJson)) {
            const fullPath = path.join(base, entry.name);
            if (!profiles.includes(fullPath)) {
              profiles.push(fullPath);
            }
          }
        }
      }
    } catch {
      // Tolerate directory read errors
    }
  }

  return profiles;
}

/**
 * Scans a single Chromium profile directory.
 * If Preferences cannot be read or is corrupt, reports available: false with reason.
 */
export function scanChromiumProfile(
  profileDir: string,
  browser: BrowserId = 'chrome'
): { available: boolean; reason?: string; extensions: ExtensionItem[] } {
  const prefPath = path.join(profileDir, 'Preferences');
  if (!fs.existsSync(prefPath)) {
    return {
      available: false,
      reason: `Preferences file does not exist at ${prefPath}`,
      extensions: [],
    };
  }

  try {
    const content = fs.readFileSync(prefPath, 'utf8');
    const parsed = parseChromiumPreferences(content, { profilePath: profileDir, browser });
    if (parsed.error) {
      return {
        available: false,
        reason: parsed.error,
        extensions: [],
      };
    }
    return {
      available: true,
      extensions: parsed.extensions,
    };
  } catch (err: any) {
    return {
      available: false,
      reason: `Failed to read Preferences: ${err?.message || String(err)}`,
      extensions: [],
    };
  }
}

/**
 * Scans a single Firefox profile directory.
 * If extensions.json cannot be read or is corrupt, reports available: false with reason.
 */
export function scanFirefoxProfile(
  profileDir: string
): { available: boolean; reason?: string; extensions: ExtensionItem[] } {
  const extJsonPath = path.join(profileDir, 'extensions.json');
  if (!fs.existsSync(extJsonPath)) {
    return {
      available: false,
      reason: `extensions.json does not exist at ${extJsonPath}`,
      extensions: [],
    };
  }

  try {
    const content = fs.readFileSync(extJsonPath, 'utf8');
    const parsed = parseFirefoxExtensionsJson(content, { profilePath: profileDir });
    if (parsed.error) {
      return {
        available: false,
        reason: parsed.error,
        extensions: [],
      };
    }
    return {
      available: true,
      extensions: parsed.extensions,
    };
  } catch (err: any) {
    return {
      available: false,
      reason: `Failed to read extensions.json: ${err?.message || String(err)}`,
      extensions: [],
    };
  }
}

/**
 * Scans a Chromium browser across all its discovered profiles.
 */
export async function scanChromiumBrowser(
  browserId: BrowserId,
  userDataDir: string
): Promise<BrowserStatus & { extensions: ExtensionItem[] }> {
  if (!fs.existsSync(userDataDir)) {
    return {
      installed: false,
      available: false,
      reason: 'Browser directory does not exist',
      profileCount: 0,
      extensions: [],
    };
  }

  const profiles = findChromiumProfiles(userDataDir);
  if (profiles.length === 0) {
    return {
      installed: true,
      available: false,
      reason: 'No profiles found containing a Preferences file',
      profileCount: 0,
      extensions: [],
    };
  }

  const allExtensions: ExtensionItem[] = [];
  const errors: string[] = [];
  let successfulProfiles = 0;

  for (const prof of profiles) {
    const scan = scanChromiumProfile(prof, browserId);
    if (scan.available) {
      successfulProfiles++;
      allExtensions.push(...scan.extensions);
    } else if (scan.reason) {
      errors.push(`${path.basename(prof)}: ${scan.reason}`);
    }
  }

  if (successfulProfiles === 0) {
    return {
      installed: true,
      available: false,
      reason: errors.join('; ') || 'All profiles failed to read Preferences',
      profileCount: profiles.length,
      extensions: [],
    };
  }

  return {
    installed: true,
    available: true,
    reason: errors.length > 0 ? `Partial failure: ${errors.join('; ')}` : undefined,
    profileCount: profiles.length,
    extensions: allExtensions,
  };
}

/**
 * Scans Firefox across all its discovered profiles.
 */
export async function scanFirefoxBrowser(
  firefoxBaseDir: string
): Promise<BrowserStatus & { extensions: ExtensionItem[] }> {
  if (!fs.existsSync(firefoxBaseDir)) {
    return {
      installed: false,
      available: false,
      reason: 'Firefox directory does not exist',
      profileCount: 0,
      extensions: [],
    };
  }

  const profiles = findFirefoxProfiles(firefoxBaseDir);
  if (profiles.length === 0) {
    return {
      installed: true,
      available: false,
      reason: 'No profiles found containing an extensions.json file',
      profileCount: 0,
      extensions: [],
    };
  }

  const allExtensions: ExtensionItem[] = [];
  const errors: string[] = [];
  let successfulProfiles = 0;

  for (const prof of profiles) {
    const scan = scanFirefoxProfile(prof);
    if (scan.available) {
      successfulProfiles++;
      allExtensions.push(...scan.extensions);
    } else if (scan.reason) {
      errors.push(`${path.basename(prof)}: ${scan.reason}`);
    }
  }

  if (successfulProfiles === 0) {
    return {
      installed: true,
      available: false,
      reason: errors.join('; ') || 'All profiles failed to read extensions.json',
      profileCount: profiles.length,
      extensions: [],
    };
  }

  return {
    installed: true,
    available: true,
    reason: errors.length > 0 ? `Partial failure: ${errors.join('; ')}` : undefined,
    profileCount: profiles.length,
    extensions: allExtensions,
  };
}

/**
 * Scans all supported browsers (Chrome, Edge, Brave, Firefox).
 */
export async function scanAllBrowsers(options?: {
  baseDirs?: Partial<Record<BrowserId, string>>;
}): Promise<ExtensionScanResult> {
  const baseDirs = { ...getBrowserBaseDirs(), ...options?.baseDirs };
  const allExtensions: ExtensionItem[] = [];
  const browsers: Record<BrowserId, BrowserStatus> = {
    chrome: { installed: false, available: false },
    edge: { installed: false, available: false },
    brave: { installed: false, available: false },
    firefox: { installed: false, available: false },
  };

  // Chromium browsers
  const chromiumBrowsers: BrowserId[] = ['chrome', 'edge', 'brave'];
  for (const b of chromiumBrowsers) {
    const dir = baseDirs[b];
    const res = await scanChromiumBrowser(b, dir);
    browsers[b] = {
      installed: res.installed,
      available: res.available,
      reason: res.reason,
      profileCount: res.profileCount,
    };
    allExtensions.push(...res.extensions);
  }

  // Firefox
  const firefoxDir = baseDirs.firefox;
  const ffRes = await scanFirefoxBrowser(firefoxDir);
  browsers.firefox = {
    installed: ffRes.installed,
    available: ffRes.available,
    reason: ffRes.reason,
    profileCount: ffRes.profileCount,
  };
  allExtensions.push(...ffRes.extensions);

  return {
    extensions: allExtensions,
    browsers,
    scannedAt: new Date().toISOString(),
  };
}

// In-memory cache for app's lifetime
let cachedScanResult: ExtensionScanResult | null = null;

/**
 * Returns extension scan result, utilizing in-memory cache unless forceRescan is requested.
 */
export async function getExtensions(
  forceRescan = false,
  options?: { baseDirs?: Partial<Record<BrowserId, string>> }
): Promise<ExtensionScanResult> {
  if (cachedScanResult && !forceRescan) {
    return cachedScanResult;
  }
  const result = await scanAllBrowsers(options);
  cachedScanResult = result;
  return result;
}

/**
 * Discards the cache and rescans all browsers.
 */
export async function rescanExtensions(options?: {
  baseDirs?: Partial<Record<BrowserId, string>>;
}): Promise<ExtensionScanResult> {
  clearExtensionsCache();
  return getExtensions(true, options);
}

/**
 * Clears the in-memory cache.
 */
export function clearExtensionsCache(): void {
  cachedScanResult = null;
}

/**
 * Locates the firefox.exe executable on the host system.
 */
export function locateFirefoxExecutable(
  env: NodeJS.ProcessEnv = process.env,
  options?: { customExePath?: string; allowPosixFallback?: boolean }
): string | null {
  if (options?.customExePath) {
    return fs.existsSync(options.customExePath) ? options.customExePath : null;
  }
  const candidatePaths = [
    path.join(env.PROGRAMFILES || 'C:\\Program Files', 'Mozilla Firefox', 'firefox.exe'),
    path.join(env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Mozilla Firefox', 'firefox.exe'),
    path.join(env.LOCALAPPDATA || '', 'Mozilla Firefox', 'firefox.exe'),
  ];

  if (options?.allowPosixFallback) {
    candidatePaths.push('/usr/bin/firefox', '/usr/local/bin/firefox');
  }

  for (const p of candidatePaths) {
    try {
      if (fs.existsSync(p)) return p;
    } catch {
      // Continue
    }
  }

  return null;
}

/**
 * Deep-links to the browser's native extensions page.
 * Strictly satisfies:
 * 1. Firefox cannot work with shell.openExternal('about:addons') -> spawns firefox.exe -url about:addons.
 * 2. Chrome, Edge, Brave use shell.openExternal.
 * 3. Awaits the launch and returns { success: false, reason } on rejection.
 * 4. Offered only for installed browsers.
 */
export async function openExtensionPage(
  browser: BrowserId,
  options?: {
    customBaseDirs?: Partial<Record<BrowserId, string>>;
    shellOpenExternal?: (url: string) => Promise<void>;
    spawnFn?: typeof spawn;
    firefoxExePath?: string;
    locateFirefoxExe?: () => string | null;
  }
): Promise<ExtensionOpenResult> {
  // Check if browser is installed
  if (!isBrowserInstalled(browser, options?.customBaseDirs)) {
    return {
      success: false,
      reason: `Cannot open extensions page: ${browser} is not installed on this system.`,
    };
  }

  if (browser === 'firefox') {
    const locateFirefoxExe = options?.locateFirefoxExe ?? locateFirefoxExecutable;
    const firefoxExe = options?.firefoxExePath ?? locateFirefoxExe();
    if (!firefoxExe) {
      return {
        success: false,
        reason: 'Mozilla Firefox executable (firefox.exe) could not be located on this system.',
      };
    }

    const spawner = options?.spawnFn || spawn;
    return new Promise((resolve) => {
      let settled = false;
      try {
        const child = spawner(firefoxExe, ['-url', 'about:addons'], {
          detached: true,
          stdio: 'ignore',
        });

        child.on('error', (err: any) => {
          if (!settled) {
            settled = true;
            resolve({
              success: false,
              reason: `Failed to launch Firefox: ${err?.message || String(err)}`,
            });
          }
        });

        // Ensure immediate spawn errors are caught before resolving
        setTimeout(() => {
          if (!settled) {
            settled = true;
            try {
              child.unref();
            } catch {
              // Ignore
            }
            resolve({ success: true });
          }
        }, 80);
      } catch (err: any) {
        if (!settled) {
          settled = true;
          resolve({
            success: false,
            reason: `Error spawning Firefox: ${err?.message || String(err)}`,
          });
        }
      }
    });
  }

  // Chromium browsers: Chrome, Edge, Brave
  const urlMap: Record<Exclude<BrowserId, 'firefox'>, string> = {
    chrome: 'chrome://extensions',
    edge: 'edge://extensions',
    brave: 'brave://extensions',
  };

  const targetUrl = urlMap[browser as Exclude<BrowserId, 'firefox'>];
  const opener = options?.shellOpenExternal || getElectronShell()?.openExternal;

  if (!opener) {
    return {
      success: false,
      reason: 'System shell openExternal is not available in current environment.',
    };
  }

  try {
    await opener(targetUrl);
    return { success: true };
  } catch (err: any) {
    return {
      success: false,
      reason: err?.message || String(err),
    };
  }
}
