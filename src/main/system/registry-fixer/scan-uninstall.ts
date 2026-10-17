import { RegistryFixerIssue } from '../../../shared/types';
import { readSubKeysWithValues, RegistryHive } from '../registry';
import {
  checkPathOutcome,
  isNetworkPath,
  cleanPath,
  PathCheckOptions,
  NetworkPathOptions,
} from './path-check';

export interface RawUninstallEntry {
  subKey: string;
  DisplayName?: string;
  InstallLocation?: string;
  UninstallString?: string;
  DisplayIcon?: string;
  SystemComponent?: unknown;
}

export interface UninstallScanOptions extends PathCheckOptions, NetworkPathOptions {
  readEntries?: (hive: RegistryHive, keyPath: string) => Promise<RawUninstallEntry[]>;
  roots?: ReadonlyArray<{ hive: RegistryHive; keyPath: string }>;
}

export interface UninstallScanResult {
  issues: RegistryFixerIssue[];
  indeterminateCount: number;
  skippedNetworkCount: number;
}

export const UNINSTALL_ROOTS: ReadonlyArray<{ hive: RegistryHive; keyPath: string }> = [
  { hive: 'HKLM', keyPath: 'SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall' },
  { hive: 'HKLM', keyPath: 'SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall' },
  { hive: 'HKCU', keyPath: 'SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall' },
];

/**
 * Checks whether an entry is marked as a system component (Exclusion 1).
 */
export function isSystemComponent(systemComponent?: unknown): boolean {
  if (systemComponent === 1 || systemComponent === '1') {
    return true;
  }
  if (typeof systemComponent === 'number' && systemComponent === 1) {
    return true;
  }
  return false;
}

/**
 * Checks whether the uninstall entry uses msiexec.exe or rundll32.exe (Exclusion 2).
 * Target is the Windows Installer database product code or DLL function, not a file path.
 */
export function isWindowsInstallerOrRundllEntry(
  uninstallString?: unknown,
  displayIcon?: unknown
): boolean {
  const pattern = /\b(msiexec(\.exe)?|rundll32(\.exe)?)\b/i;
  if (typeof uninstallString === 'string' && pattern.test(uninstallString)) {
    return true;
  }
  if (typeof displayIcon === 'string' && pattern.test(displayIcon)) {
    return true;
  }
  return false;
}

/**
 * Default reader that uses readSubKeysWithValues from registry.ts.
 */
async function defaultReadEntries(
  hive: RegistryHive,
  keyPath: string
): Promise<RawUninstallEntry[]> {
  const records = await readSubKeysWithValues(hive, keyPath);
  return records.map((rec) => {
    const v = rec.values || {};
    return {
      subKey: rec.subKey,
      DisplayName: typeof v.DisplayName === 'string' ? v.DisplayName : undefined,
      InstallLocation: typeof v.InstallLocation === 'string' ? v.InstallLocation : undefined,
      UninstallString: typeof v.UninstallString === 'string' ? v.UninstallString : undefined,
      DisplayIcon: typeof v.DisplayIcon === 'string' ? v.DisplayIcon : undefined,
      SystemComponent: v.SystemComponent,
    };
  });
}

/**
 * Scans the three Windows Uninstall registry keys for orphaned entries.
 *
 * Algorithm per docs/PHASE-7-8-REGISTRYFIXER.md:
 * For each UninstallKey in [HKLM, HKLM\WOW6432Node, HKCU]:
 *   For each Subkey:
 *     1. If SystemComponent equals 1 -> Skip
 *     2. If UninstallString or DisplayIcon references msiexec.exe or rundll32.exe -> Skip
 *     3. If InstallLocation is absent or empty -> Skip
 *     4. If InstallLocation is UNC path or mapped network drive -> Skip, increment skippedNetworkCount
 *     5. outcome = checkPathOutcome(InstallLocation)
 *        - 'gone': Flag as orphaned_uninstall, evidence: { checkedPath, outcome: 'gone' }
 *        - 'indeterminate': Skip, increment indeterminateCount
 *        - 'exists': Skip
 */
export async function scanUninstall(
  options?: UninstallScanOptions
): Promise<UninstallScanResult> {
  const reader = options?.readEntries ?? defaultReadEntries;
  const issues: RegistryFixerIssue[] = [];
  let indeterminateCount = 0;
  let skippedNetworkCount = 0;

  const roots = options?.roots ?? UNINSTALL_ROOTS;
  for (const root of roots) {
    let entries: RawUninstallEntry[] = [];
    try {
      entries = await reader(root.hive, root.keyPath);
    } catch (err) {
      console.warn(`Failed to read uninstall entries from ${root.hive}\\${root.keyPath}:`, err);
      continue;
    }

    for (const entry of entries) {
      // Exclusion 1: system components
      if (isSystemComponent(entry.SystemComponent)) {
        continue;
      }

      // Exclusion 2: Windows Installer / rundll32 entries
      if (isWindowsInstallerOrRundllEntry(entry.UninstallString, entry.DisplayIcon)) {
        continue;
      }

      // Exclusion 3: no install location
      const installLocation = cleanPath(entry.InstallLocation || '');
      if (!installLocation) {
        continue;
      }

      // Exclusion 4: network paths
      const isRemote = await isNetworkPath(installLocation, options);
      if (isRemote) {
        skippedNetworkCount++;
        continue;
      }

      // Detection: three-outcome check
      const outcome = await checkPathOutcome(installLocation, options);
      if (outcome === 'gone') {
        const fullKeyPath = `${root.keyPath}\\${entry.subKey}`;
        const displayName =
          typeof entry.DisplayName === 'string' && entry.DisplayName.trim()
            ? entry.DisplayName.trim()
            : entry.subKey;

        issues.push({
          id: `uninstall-${root.hive}-${fullKeyPath}`,
          type: 'orphaned_uninstall',
          hive: root.hive,
          keyPath: fullKeyPath,
          valueName: undefined,
          displayName,
          description: `Install directory does not exist on disk: ${installLocation}`,
          severity: 'low',
          selected: true,
          evidence: {
            checkedPath: installLocation,
            outcome: 'gone',
          },
        });
      } else if (outcome === 'indeterminate') {
        indeterminateCount++;
      }
      // 'exists': do not flag
    }
  }

  return {
    issues,
    indeterminateCount,
    skippedNetworkCount,
  };
}
