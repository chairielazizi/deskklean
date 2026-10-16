import fs from 'fs';
import path from 'path';
import os from 'os';
import { BackupMetadata, StartupBackup } from './types';
import { mergeRegSnippets } from '../registry';

/**
 * Resolves the shared backup store directory for a given module.
 * Path pattern: <userData>/backups/<module>/
 */
export function getModuleBackupDir(moduleName: string, customUserDataDir?: string): string {
  let baseDir: string;
  if (customUserDataDir) {
    baseDir = customUserDataDir;
  } else {
    try {
      // If running inside Electron, align with app.getPath('userData')
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const electron = require('electron');
      if (electron?.app?.getPath) {
        baseDir = electron.app.getPath('userData');
      } else if (process.env.APPDATA) {
        baseDir = path.join(process.env.APPDATA, 'DeskKlean');
      } else {
        baseDir = path.join(os.homedir(), 'AppData', 'Roaming', 'DeskKlean');
      }
    } catch {
      baseDir = process.env.APPDATA
        ? path.join(process.env.APPDATA, 'DeskKlean')
        : path.join(os.homedir(), 'AppData', 'Roaming', 'DeskKlean');
    }
  }
  return path.join(baseDir, 'backups', moduleName);
}

/**
 * Migration helper: Moves legacy <userData>/registry_backups/ to <userData>/backups/startup/.
 *
 * Rails:
 * 1. Detect existing registry_backups directory.
 * 2. Move contents to backups/startup/, preserving filenames.
 * 3. Record move in activity log.
 * 4. Only remove source directory after move succeeds.
 * 5. If move fails, leave source in place and keep writing to it.
 */
export function migrateLegacyBackups(
  userDataDir: string,
  logActivity?: (item: {
    module: string;
    title: string;
    detail: string;
    type: 'info' | 'success' | 'warning' | 'error';
  }) => void
): { migratedCount: number; success: boolean } {
  try {
    const legacyDir = path.join(userDataDir, 'registry_backups');
    if (!fs.existsSync(legacyDir)) {
      return { migratedCount: 0, success: true };
    }

    const files = fs.readdirSync(legacyDir);
    if (files.length === 0) {
      try {
        fs.rmdirSync(legacyDir);
      } catch {}
      return { migratedCount: 0, success: true };
    }

    const targetDir = getModuleBackupDir('startup', userDataDir);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    let movedCount = 0;
    for (const file of files) {
      const srcPath = path.join(legacyDir, file);
      const dstPath = path.join(targetDir, file);
      try {
        fs.copyFileSync(srcPath, dstPath);
        fs.unlinkSync(srcPath);
        movedCount++;
      } catch (err) {
        console.warn(`Failed to move backup ${file}:`, err);
        return { migratedCount: movedCount, success: false };
      }
    }

    // Only remove source directory after all moves succeed
    try {
      fs.rmdirSync(legacyDir);
    } catch {}

    if (logActivity && movedCount > 0) {
      logActivity({
        module: 'startup-optimizer',
        title: 'Legacy Backups Migrated',
        detail: `Migrated ${movedCount} legacy backup(s) from registry_backups to backups/startup/`,
        type: 'info',
      });
    }

    return { migratedCount: movedCount, success: true };
  } catch (err) {
    console.error('Migration failed:', err);
    return { migratedCount: 0, success: false };
  }
}

/**
 * Builds the complete .reg file content with the Phase 2 / Phase 3 metadata comment header.
 */
export function formatRegWithMetadata(
  snippets: string[],
  metadata: BackupMetadata
): string {
  const HEADER = 'Windows Registry Editor Version 5.00';
  const commentLines = [
    '; DeskKlean Backup Metadata',
    `; Module: ${metadata.module}`,
    `; Item: ${metadata.itemName}`,
    metadata.hive ? `; Hive: ${metadata.hive}` : '',
    metadata.location ? `; Location: ${metadata.location}` : '',
    metadata.valueName ? `; ValueName: ${metadata.valueName}` : '',
    `; Timestamp: ${metadata.timestamp}`,
  ]
    .filter(Boolean)
    .join('\r\n');

  const merged = mergeRegSnippets(snippets);
  const headerWithNewline = `${HEADER}\r\n\r\n`;

  if (merged.startsWith(headerWithNewline)) {
    return `${HEADER}\r\n\r\n${commentLines}\r\n\r\n${merged.slice(headerWithNewline.length)}`;
  }
  return `${HEADER}\r\n\r\n${commentLines}\r\n\r\n${merged}`;
}

/**
 * Writes a .reg backup file with BOM and metadata comment header.
 * Aborts and throws if the written file does not start with BOM (FF FE).
 */
export function writeRegBackupFile(
  backupFilePath: string,
  snippets: string[],
  metadata: BackupMetadata
): void {
  const dir = path.dirname(backupFilePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const content = formatRegWithMetadata(snippets, metadata);

  // Write file as UTF-16LE WITH a BOM (\uFEFF)
  fs.writeFileSync(backupFilePath, '\uFEFF' + content, { encoding: 'utf16le' });

  // Re-read and assert BOM bytes FF FE
  const headerCheck = Buffer.alloc(2);
  const fd = fs.openSync(backupFilePath, 'r');
  fs.readSync(fd, headerCheck, 0, 2, 0);
  fs.closeSync(fd);

  if (headerCheck[0] !== 0xff || headerCheck[1] !== 0xfe) {
    throw new Error('Backup file BOM check failed: first bytes are not FF FE');
  }
}

/**
 * Reads a backup file buffer safely, detecting UTF-16LE (BOM FF FE) or UTF-8.
 */
export function readBackupFileText(filePath: string): string {
  const buffer = fs.readFileSync(filePath);
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return buffer.toString('utf16le');
  }
  return buffer.toString('utf-8');
}

/**
 * Parses metadata comment header from .reg content.
 */
export function parseRegMetadata(content: string): Partial<BackupMetadata> {
  const meta: Partial<BackupMetadata> = {};

  const moduleMatch = content.match(/;\s*Module:\s*(.+)/i);
  if (moduleMatch) meta.module = moduleMatch[1].trim();

  const itemMatch = content.match(/;\s*Item:\s*(.+)/i);
  if (itemMatch) meta.itemName = itemMatch[1].trim();

  const hiveMatch = content.match(/;\s*Hive:\s*(HKCU|HKLM)/i);
  if (hiveMatch) meta.hive = hiveMatch[1].trim().toUpperCase() as 'HKCU' | 'HKLM';

  const locMatch = content.match(/;\s*Location:\s*(.+)/i);
  if (locMatch) meta.location = locMatch[1].trim();

  const valMatch = content.match(/;\s*ValueName:\s*(.+)/i);
  if (valMatch) meta.valueName = valMatch[1].trim();

  const timeMatch = content.match(/;\s*Timestamp:\s*(.+)/i);
  if (timeMatch) meta.timestamp = timeMatch[1].trim();

  return meta;
}

/**
 * Parses what was changed or backed up from the snippets in the .reg content.
 */
export function summarizeRegChange(content: string): string {
  const hasDisabledFlag = /hex:03,/i.test(content);
  const hasEnabledFlag = /hex:02,/i.test(content);
  const hasDeleteFlag = /"=-/i.test(content);

  if (hasDisabledFlag) {
    return 'Saved Run command (toggled to disabled)';
  }
  if (hasEnabledFlag) {
    return 'Saved Run command (toggled to enabled)';
  }
  if (hasDeleteFlag) {
    return 'Saved Run command (deleted flag on rollback)';
  }
  return 'Saved Run command and StartupApproved flag';
}

/**
 * Path traversal guard: ensures an ID or filename resolves strictly inside the designated directory.
 */
export function validatePathInsideDir(baseDir: string, relativeOrId: string): string | null {
  if (!relativeOrId || relativeOrId.includes('\0')) {
    return null;
  }

  const filename = relativeOrId.endsWith('.reg') ? relativeOrId : `${relativeOrId}.reg`;
  // Disallow path traversal tokens in the ID
  if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    return null;
  }

  const resolvedBase = path.resolve(baseDir);
  const resolvedTarget = path.resolve(resolvedBase, filename);

  const normBase = resolvedBase.replace(/\\/g, '/').toLowerCase();
  const normTarget = resolvedTarget.replace(/\\/g, '/').toLowerCase();

  if (!normTarget.startsWith(normBase + '/')) {
    return null;
  }

  return resolvedTarget;
}

/**
 * Validates a backup file before importing.
 *
 * Rails:
 * 1. Path traversal guard.
 * 2. File must exist.
 * 3. File content must start with "Windows Registry Editor Version 5.00".
 */
export function validateBackupForRestore(
  moduleName: string,
  backupId: string,
  customUserDataDir?: string
): {
  valid: boolean;
  reason?: string;
  filePath?: string;
  metadata?: Partial<BackupMetadata>;
  content?: string;
} {
  const backupDir = getModuleBackupDir(moduleName, customUserDataDir);
  const resolvedPath = validatePathInsideDir(backupDir, backupId);

  if (!resolvedPath) {
    return {
      valid: false,
      reason: 'Path traversal or invalid backup filename detected; restore refused.',
    };
  }

  if (!fs.existsSync(resolvedPath)) {
    return {
      valid: false,
      reason: `Backup file does not exist: ${path.basename(resolvedPath)}`,
    };
  }

  try {
    const content = readBackupFileText(resolvedPath);
    const cleanHeader = content.replace(/^\uFEFF/, '').trimStart();

    if (!cleanHeader.startsWith('Windows Registry Editor Version 5.00')) {
      return {
        valid: false,
        reason:
          'Invalid backup file format: missing "Windows Registry Editor Version 5.00" header.',
      };
    }

    const metadata = parseRegMetadata(content);

    return {
      valid: true,
      filePath: resolvedPath,
      metadata,
      content,
    };
  } catch (err) {
    return {
      valid: false,
      reason: `Failed to read backup file: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Lists all backups for a module, reading real files and parsing their metadata.
 */
export function listModuleBackups(
  moduleName: string,
  customUserDataDir?: string
): StartupBackup[] {
  const backupDir = getModuleBackupDir(moduleName, customUserDataDir);
  if (!fs.existsSync(backupDir)) {
    return [];
  }

  try {
    const files = fs
      .readdirSync(backupDir)
      .filter((f) => f.toLowerCase().endsWith('.reg'));

    const items: StartupBackup[] = [];

    for (const file of files) {
      const fullPath = path.join(backupDir, file);
      try {
        const stats = fs.statSync(fullPath);
        const content = readBackupFileText(fullPath);
        const meta = parseRegMetadata(content);

        // Fallback: parse filename <ISO>-<hive>-<name>.reg if header was missing
        let itemName = meta.itemName;
        let hive = meta.hive;
        let timestamp = meta.timestamp || stats.mtime.toISOString();

        if (!itemName || !hive) {
          const match = file.match(/^(.+?)-(HKCU|HKLM)-(.+?)\.reg$/i);
          if (match) {
            timestamp = timestamp || match[1].replace(/-/g, ':');
            hive = (match[2].toUpperCase() as 'HKCU' | 'HKLM') || 'HKCU';
            itemName = itemName || match[3].replace(/_/g, ' ');
          }
        }

        const changeSummary = summarizeRegChange(content);

        items.push({
          id: file.replace(/\.reg$/i, ''),
          timestamp,
          filePath: fullPath,
          itemName: itemName || file.replace(/\.reg$/i, ''),
          hive: hive || 'HKCU',
          location: meta.location || `${hive || 'HKCU'}_RUN`,
          valueName: meta.valueName || itemName || file,
          changeSummary,
          sizeBytes: stats.size,
        });
      } catch (err) {
        console.warn(`Failed to parse backup ${file}:`, err);
      }
    }

    // Sort newest first
    return items.sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
  } catch (err) {
    console.error(`Failed to list backups for ${moduleName}:`, err);
    return [];
  }
}
