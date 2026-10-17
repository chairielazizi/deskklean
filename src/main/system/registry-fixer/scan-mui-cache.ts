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
 * Extracts the file path from a MUICache value name by stripping known suffixes
 * (.ApplicationCompany, .ApplicationName) and trimming quotes.
 */
export function extractMuiCacheFilePath(valueName: string): string {
  if (typeof valueName !== 'string') return '';
  let cleaned = valueName.trim();
  for (const suffix of KNOWN_MUI_CACHE_SUFFIXES) {
    if (cleaned.toLowerCase().endsWith(suffix.toLowerCase())) {
      cleaned = cleaned.slice(0, -suffix.length);
      break;
    }
  }
  return cleanPath(cleaned);
}

/**
 * Checks if a string looks like an absolute Windows file path (drive rooted or UNC).
 * Filters out non-path registry values such as "LangID" or default markers.
 */
export function isCandidateFilePath(p: string): boolean {
  if (!p) return false;
  return /^[a-zA-Z]:[\\/]/.test(p) || /^[\\/]{2}/.test(p);
}

/**
 * Scans HKCU MUICache for values whose referenced executable file provably no longer exists.
 *
 * Algorithm per docs/PHASE-7-8-REGISTRYFIXER.md:
 * For each Value in MuiCache:
 *   1. Extract file path from value name (strip known suffixes)
 *   2. If filepath is UNC path or mapped network drive -> Skip, increment skippedNetworkCount
 *   3. outcome = checkPathOutcome(filepath)
 *      - 'gone': Flag as stale_mui_cache, evidence: { checkedPath, outcome: 'gone' }
 *      - 'indeterminate': Skip, increment indeterminateCount
 *      - 'exists': Skip
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
    const filePath = extractMuiCacheFilePath(valueName);

    // Skip non-path entries like "LangID"
    if (!isCandidateFilePath(filePath)) {
      continue;
    }

    // Network paths are skipped
    const isRemote = await isNetworkPath(filePath, options);
    if (isRemote) {
      skippedNetworkCount++;
      continue;
    }

    // Three outcomes, only one is a flag
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
