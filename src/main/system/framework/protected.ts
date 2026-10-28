import path from 'path';
import fs from 'fs';
import os from 'os';

/**
 * Resolves paths with Windows drive letters accurately on both Windows and Linux.
 */
export function resolvePathCrossPlatform(targetPath: string): string {
  const winMatch = targetPath.match(/^([a-zA-Z]:)[\\\/]?(.*)$/);
  if (winMatch) {
    const drive = winMatch[1].toUpperCase();
    const rest = winMatch[2].replace(/\\/g, '/');
    const parts = rest.split('/').filter(Boolean);
    const resolvedParts: string[] = [];
    for (const part of parts) {
      if (part === '.') continue;
      if (part === '..') {
        resolvedParts.pop();
      } else {
        resolvedParts.push(part);
      }
    }
    return resolvedParts.length > 0 ? `${drive}\\${resolvedParts.join('\\')}` : `${drive}\\`;
  }
  return path.resolve(targetPath);
}

/**
 * Normalizes Windows-style paths for reliable cross-platform and case-insensitive comparison.
 * Standardizes backslashes to forward slashes or standard separators and lowercases.
 */
export function normalizePathForComparison(p: string): string {
  const resolved = resolvePathCrossPlatform(p);
  return resolved.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

/**
 * Expands common Windows environment variables into standard paths.
 */
export function getSystemPaths(): {
  systemRoot: string;
  systemDrive: string;
  programFiles: string;
  programFilesX86: string;
  programData: string;
  userProfile: string;
} {
  const systemRoot = process.env.SystemRoot || process.env.windir || 'C:\\Windows';
  const systemDrive = process.env.SystemDrive || 'C:';
  const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
  const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const programData = process.env.ProgramData || 'C:\\ProgramData';
  const userProfile = process.env.USERPROFILE || os.homedir();

  return {
    systemRoot,
    systemDrive,
    programFiles,
    programFilesX86,
    programData,
    userProfile,
  };
}

/**
 * Returns the unconditionally protected paths list.
 */
export function getProtectedPaths(
  customExcludedPaths: string[] = [],
  options?: { allowUserData?: boolean }
): string[] {
  const sys = getSystemPaths();

  const protectedRoots = [
    sys.systemRoot,
    sys.programFiles,
    sys.programFilesX86,
    sys.programData,
    path.join(sys.systemDrive, 'System Volume Information'),
    path.join(sys.systemDrive, '$Recycle.Bin'),
    path.join(sys.systemRoot, 'Installer'),
    path.join(sys.systemRoot, 'WinSxS'),
    path.join(sys.systemDrive, 'pagefile.sys'),
    path.join(sys.systemDrive, 'hiberfil.sys'),
    path.join(sys.systemDrive, 'swapfile.sys'),
    path.join(sys.systemDrive, 'bootmgr'),
    path.join(sys.systemDrive, 'BOOTNXT'),
    path.join(sys.systemDrive, 'EFI'),
    ...(options?.allowUserData
      ? []
      : [
          path.join(sys.userProfile, 'Documents'),
          path.join(sys.userProfile, 'Desktop'),
          path.join(sys.userProfile, 'Pictures'),
          path.join(sys.userProfile, 'Videos'),
          path.join(sys.userProfile, 'Music'),
        ]),
    ...customExcludedPaths,
  ];

  return protectedRoots;
}

/**
 * Returns the allowlisted safe subpaths under %SystemRoot% and %ProgramData%.
 */
export function getSafeSubpaths(): string[] {
  const sys = getSystemPaths();

  return [
    path.join(sys.systemRoot, 'Temp'),
    path.join(sys.systemRoot, 'Logs'),
    path.join(sys.systemRoot, 'Panther'),
    path.join(sys.systemRoot, 'Minidump'),
    path.join(sys.systemRoot, 'MEMORY.DMP'),
    path.join(
      sys.systemRoot,
      'ServiceProfiles',
      'NetworkService',
      'AppData',
      'Local',
      'Microsoft',
      'Windows',
      'DeliveryOptimization',
      'Cache'
    ),
    path.join(sys.programData, 'Microsoft', 'Windows', 'WER', 'ReportQueue'),
    path.join(sys.programData, 'Microsoft', 'Windows', 'WER', 'ReportArchive'),
  ];
}

export interface PathValidationResult {
  allowed: boolean;
  reason?: string;
  resolvedPath?: string;
}

/**
 * Central enforcement of the protected list and path validation rules.
 * Enforces Phase 3 rails:
 * 1. Must be a string, non-empty, absolute.
 * 2. Must not contain null bytes.
 * 3. Must resolve without traversal evasion (fs.realpath when available, or path.resolve).
 * 4. Must not be outside declared scan root (symlink/junction escape guard).
 * 5. Must not match protected paths unless specifically inside an allowlisted safe subpath.
 * 6. Must not be a parent of a protected path (e.g. 'C:\Windows\Temp\..').
 */
export function validatePath(
  targetPath: string,
  options: {
    scanRoot?: string;
    customExcludedPaths?: string[];
    backupDir?: string;
    appDir?: string;
    allowNonExistent?: boolean;
    allowUserData?: boolean;
    allowAppLocations?: boolean;
  } = {}
): PathValidationResult {
  // 1. String, non-empty, absolute
  if (typeof targetPath !== 'string' || !targetPath.trim()) {
    return { allowed: false, reason: 'Target path must be a non-empty string' };
  }

  // 2. Null byte check
  if (targetPath.includes('\0')) {
    return { allowed: false, reason: 'Target path contains illegal null bytes' };
  }

  // Windows or POSIX absolute check
  const isAbs = path.isAbsolute(targetPath) || /^[a-zA-Z]:[\\\/]/.test(targetPath);
  if (!isAbs) {
    return { allowed: false, reason: 'Target path must be an absolute path' };
  }

  // 3. Resolve path (fs.realpathSync if file exists, else resolvePathCrossPlatform)
  let resolved: string;
  try {
    if (fs.existsSync(targetPath)) {
      resolved = fs.realpathSync(targetPath);
    } else {
      resolved = resolvePathCrossPlatform(targetPath);
    }
  } catch (err) {
    return {
      allowed: false,
      reason: `Path resolution failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const normResolved = normalizePathForComparison(resolved);

  // 4. Reparse point / Symlink scope check if scanRoot provided
  if (options.scanRoot) {
    const normRoot = normalizePathForComparison(options.scanRoot);
    if (!normResolved.startsWith(normRoot)) {
      return {
        allowed: false,
        reason: `Target path escapes declared scan root: ${normResolved} is outside ${normRoot}`,
      };
    }
  }

  // Check DeskKlean's own backup directory
  if (options.backupDir) {
    const normBackup = normalizePathForComparison(options.backupDir);
    if (normResolved === normBackup || normResolved.startsWith(normBackup + '/')) {
      return {
        allowed: false,
        reason: "Refused target inside DeskKlean's own backup directory (destroying the undo)",
      };
    }
  }

  // Check running app directory
  if (options.appDir) {
    const normApp = normalizePathForComparison(options.appDir);
    if (normResolved === normApp || normResolved.startsWith(normApp + '/')) {
      return {
        allowed: false,
        reason: "Refused target inside DeskKlean application files",
      };
    }
  }

  // Check safe subpaths allowlist
  const safeSubpaths = getSafeSubpaths().map(normalizePathForComparison);
  const isUnderSafeSubpath = safeSubpaths.some(
    (safe) => normResolved === safe || normResolved.startsWith(safe + '/')
  );

  if (isUnderSafeSubpath) {
    return { allowed: true, resolvedPath: resolved };
  }

  // 5. Check unconditionally protected list
  const sys = getSystemPaths();
  const protectedPaths = getProtectedPaths(options.customExcludedPaths, {
    allowUserData: options.allowUserData,
  }).map(normalizePathForComparison);

  const appRootPaths = options.allowAppLocations
    ? [
        normalizePathForComparison(sys.programFiles),
        normalizePathForComparison(sys.programFilesX86),
        normalizePathForComparison(sys.programData),
      ]
    : [];

  for (const prot of protectedPaths) {
    if (options.allowAppLocations && appRootPaths.includes(prot)) {
      if (normResolved === prot) {
        return {
          allowed: false,
          reason: `Target path matches protected root directory: ${prot}`,
        };
      }
      continue;
    }

    // Exact match or subpath match
    if (normResolved === prot || normResolved.startsWith(prot + '/')) {
      return {
        allowed: false,
        reason: `Target path matches protected system path: ${prot}`,
      };
    }

    // 6. Parent of protected path check (e.g. deleting C:\Windows or C:\)
    if (prot.startsWith(normResolved + '/')) {
      return {
        allowed: false,
        reason: `Target path is a parent of protected system path: ${prot}`,
      };
    }
  }

  return { allowed: true, resolvedPath: resolved };
}

/**
 * Registry protection rules: refuses tampering with OS-owned critical keys.
 */
export function validateRegistryPath(
  hive: string,
  keyPath: string
): { allowed: boolean; reason?: string } {
  const normHive = hive.trim().toUpperCase();
  if (normHive !== 'HKCU' && normHive !== 'HKLM' && normHive !== 'HKCR' && normHive !== 'HKU') {
    return { allowed: false, reason: `Unknown or unsupported registry hive: ${hive}` };
  }

  const normKey = keyPath.replace(/\\/g, '/').toLowerCase();

  // Protect critical SAM, SECURITY, and SYSTEM roots from direct destruction
  const criticalKeys = [
    'sam/sam',
    'security',
    'system/currentcontrolset/control/safeboot',
    'system/currentcontrolset/services/winmgmt',
  ];

  for (const crit of criticalKeys) {
    if (normKey === crit || normKey.startsWith(crit + '/')) {
      return {
        allowed: false,
        reason: `Registry key is protected by system integrity policy: ${keyPath}`,
      };
    }
  }

  return { allowed: true };
}
