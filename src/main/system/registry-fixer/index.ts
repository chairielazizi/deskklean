import { RegistryScanResult } from '../../../shared/types';
import { scanUninstall, UninstallScanOptions } from './scan-uninstall';
import { scanMuiCache, MuiCacheScanOptions } from './scan-mui-cache';

export * from './path-check';
export * from './scan-uninstall';
export * from './scan-mui-cache';

export interface RegistryFixerScanOptions
  extends UninstallScanOptions,
    MuiCacheScanOptions {}

/**
 * Executes a full read-only scan of both RegistryFixer in-scope categories:
 * 1. Orphaned Windows Uninstall subkeys
 * 2. Stale HKCU MUICache values
 *
 * Honors the binding rule: flags an entry ONLY when its referenced target is provably gone.
 */
export async function scanRegistryFixer(
  options?: RegistryFixerScanOptions
): Promise<RegistryScanResult> {
  const driveTypeCache = options?.driveTypeCache ?? new Map<string, number | null>();

  const [uninstallRes, muiRes] = await Promise.all([
    scanUninstall({ ...options, driveTypeCache }),
    scanMuiCache({ ...options, driveTypeCache }),
  ]);

  return {
    issues: [...uninstallRes.issues, ...muiRes.issues],
    scannedAt: new Date().toISOString(),
    indeterminateCount: uninstallRes.indeterminateCount + muiRes.indeterminateCount,
    skippedNetworkCount: uninstallRes.skippedNetworkCount + muiRes.skippedNetworkCount,
  };
}
