import path from 'path';
import { RegistryFixerIssue } from '../../../shared/types';
import { readKeyValues } from '../registry';
import {
  checkPathOutcome,
  isNetworkPath,
  cleanPath,
  PathCheckOptions,
  NetworkPathOptions,
} from './path-check';

export const MUI_CACHE_KEY_PATH =
  'Software\\Classes\\Local Settings\\Software\\Microsoft\\Windows\\Shell\\MuiCache';

export const KNOWN_MUI_CACHE_SUFFIXES = [
  '.ApplicationCompany',
  '.FriendlyAppName',
  '.ApplicationName',
] as const;

export interface MuiCacheScanOptions extends PathCheckOptions, NetworkPathOptions {
  readValues?: (hive: 'HKCU', keyPath: string) => Promise<Record<string, unknown>>;
}

export interface MuiCacheScanResult {
  issues: RegistryFixerIssue[];
  indeterminateCount: number;
  skippedNetworkCount: number;
}

/**
 * Suffix stripping result reporting whether a known suffix was matched.
 */
export interface StripSuffixResult {
  filePath: string;
  suffixMatched: boolean;
  matchedSuffix?: string;
}

/**
 * Strips known suffixes (.ApplicationCompany, .FriendlyAppName, .ApplicationName)
 * from a MUICache value name. Reports whether a known suffix was matched.
 */
export function stripKnownSuffix(valueName: string): StripSuffixResult {
  if (typeof valueName !== 'string') {
    return { filePath: '', suffixMatched: false };
  }
  let cleaned = valueName.trim();
  let suffixMatched = false;
  let matchedSuffix: string | undefined;

  for (const suffix of KNOWN_MUI_CACHE_SUFFIXES) {
    if (cleaned.toLowerCase().endsWith(suffix.toLowerCase())) {
      cleaned = cleaned.slice(0, -suffix.length);
      suffixMatched = true;
      matchedSuffix = suffix;
      break;
    }
  }

  return {
    filePath: cleanPath(cleaned),
    suffixMatched,
    matchedSuffix,
  };
}

/**
 * Extracts the file path from a MUICache value name by stripping known suffixes
 * (.ApplicationCompany, .FriendlyAppName, .ApplicationName) and trimming quotes.
 */
export function extractMuiCacheFilePath(valueName: string): string {
  return stripKnownSuffix(valueName).filePath;
}

/**
 * Checks if a string looks like an absolute Windows file path (drive rooted or UNC).
 * Filters out non-path registry values such as "LangID" or default markers.
 */
export function isCandidateFilePath(p: string): boolean {
  if (!p) return false;
  const cleaned = cleanPath(p);
  return /^[a-zA-Z]:[\\/]/.test(cleaned) || /^[\\/]{2}/.test(cleaned);
}

/**
 * Scans HKCU MUICache for values whose referenced executable file provably no longer exists.
 *
 * Algorithm per docs/PHASE-7-8-REGISTRYFIXER.md:
 * For each Value in MuiCache:
 *   # Skip non-path entries like "LangID"
 *   STEP 1 — Try the RAW value name as a path first.
 *     If checkPathOutcome(valueName) is 'exists', skip. A genuine filename can end
 *     in a string that looks like a known suffix (e.g. a file literally named
 *     "setup.ApplicationName"), and it must not be treated as stale.
 *   STEP 2 — Strip a known suffix.
 *     If NO known suffix matched, the entry is INDETERMINATE: increment
 *     indeterminateCount and skip. Do NOT fall through to the existence check.
 *     We cannot tell where the path ends, so we cannot prove anything is gone.
 *   STEP 3 — Only when a suffix DID match:
 *     - If filepath is UNC path or mapped network drive -> Skip, increment skippedNetworkCount
 *     - outcome = checkPathOutcome(filepath)
 *       - 'gone': Flag as stale_mui_cache, evidence: { checkedPath, outcome: 'gone' }
 *       - 'indeterminate': Skip, increment indeterminateCount
 *       - 'exists': Skip
 */
export async function scanMuiCache(
  options?: MuiCacheScanOptions
): Promise<MuiCacheScanResult> {
  const reader = options?.readValues ?? ((hive, keyPath) => readKeyValues(hive, keyPath));
  const issues: RegistryFixerIssue[] = [];
  let indeterminateCount = 0;
  let skippedNetworkCount = 0;

  let values: Record<string, unknown> = {};
  try {
    values = await reader('HKCU', MUI_CACHE_KEY_PATH);
  } catch (err) {
    console.warn(`Failed to read MUICache values from HKCU\\${MUI_CACHE_KEY_PATH}:`, err);
    return { issues: [], indeterminateCount: 0, skippedNetworkCount: 0 };
  }

  for (const valueName of Object.keys(values)) {
    // Skip non-path entries like "LangID"
    if (!isCandidateFilePath(valueName)) {
      continue;
    }

    // STEP 1 — Try the RAW value name as a path first.
    // If checkPathOutcome(valueName) is 'exists', skip. A genuine filename can end
    // in a string that looks like a known suffix (e.g. a file literally named
    // "setup.ApplicationName"), and it must not be treated as stale.
    // Network paths are never scanned on the filesystem (reachability is not provability).
    const isRawRemote = await isNetworkPath(valueName, options);
    if (!isRawRemote) {
      const rawOutcome = await checkPathOutcome(valueName, options);
      if (rawOutcome === 'exists') {
        continue;
      }
    }

    // STEP 2 — Strip a known suffix.
    // If NO known suffix matched, the entry is INDETERMINATE: increment
    // indeterminateCount and skip. Do NOT fall through to the existence check.
    // This is the critical change. We cannot tell where the path ends, so we cannot
    // prove anything is gone.
    const { filePath, suffixMatched } = stripKnownSuffix(valueName);
    if (!suffixMatched) {
      indeterminateCount++;
      continue;
    }

    // STEP 3 — Only when a suffix DID match:
    // - skip network paths (existing behaviour, increment skippedNetworkCount)
    // - checkPathOutcome(filepath): 'gone' flags, 'indeterminate' counts, 'exists' skips
    const isRemote = isRawRemote || (await isNetworkPath(filePath, options));
    if (isRemote) {
      skippedNetworkCount++;
      continue;
    }

    const outcome = await checkPathOutcome(filePath, options);
    if (outcome === 'gone') {
      const fileName = path.win32.basename(filePath) || valueName;
      issues.push({
        id: `mui-${valueName}`,
        type: 'stale_mui_cache',
        hive: 'HKCU',
        keyPath: MUI_CACHE_KEY_PATH,
        valueName,
        displayName: fileName,
        description: `Referenced application does not exist on disk: ${filePath}`,
        severity: 'low',
        selected: true,
        evidence: {
          checkedPath: filePath,
          outcome: 'gone',
        },
      });
    } else if (outcome === 'indeterminate') {
      indeterminateCount++;
    }
    // 'exists': do not flag
  }

  return {
    issues,
    indeterminateCount,
    skippedNetworkCount,
  };
}
