import fs from 'fs';
import path from 'path';
import { RegistryHive, buildRegSnippet, mergeRegSnippets } from '../registry';
import { runPowerShell, parseJsonSafe, isWindows } from '../powershell';

export interface SubKeyBackupItem {
  type: 'orphaned_uninstall';
  hive: RegistryHive;
  keyPath: string;
  values: Array<{ name: string; type: string; data: unknown }>;
}

export interface ValueBackupItem {
  type: 'stale_mui_cache';
  hive: RegistryHive;
  keyPath: string;
  valueName: string;
  valueType: string;
  data: unknown;
}

export type RegistryBackupEntry = SubKeyBackupItem | ValueBackupItem;

export interface BackupValidationResult {
  valid: boolean;
  reason?: string;
}

/**
 * Creates a slug suitable for filenames.
 */
export function slugify(str: string): string {
  return (
    str
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'entry'
  );
}

/**
 * Builds a .reg snippet for a single backup entry.
 * - For orphaned uninstall entries: exports the entire subkey with all its values,
 *   or the section header if no values exist.
 * - For stale MUICache entries: exports just the specific value.
 */
export function buildBackupSnippet(item: RegistryBackupEntry): string {
  if (item.type === 'orphaned_uninstall') {
    if (item.values.length === 0) {
      const longHive = item.hive === 'HKCU' ? 'HKEY_CURRENT_USER' : 'HKEY_LOCAL_MACHINE';
      const cleanPath = item.keyPath
        .replace(/^(HKCU:|HKLM:|HKEY_CURRENT_USER|HKEY_LOCAL_MACHINE)[\\\/]*/i, '')
        .replace(/^[\\\/]+/, '');
      return [
        'Windows Registry Editor Version 5.00',
        '',
        `[${longHive}\\${cleanPath}]`,
        '',
      ].join('\r\n');
    }

    const valSnippets = item.values.map((v) =>
      buildRegSnippet(item.hive, item.keyPath, v.name, v.data as any, v.type)
    );
    return mergeRegSnippets(valSnippets);
  } else {
    return buildRegSnippet(
      item.hive,
      item.keyPath,
      item.valueName,
      item.data as any,
      item.valueType
    );
  }
}

/**
 * Formats full .reg backup document with CRLF endings and Phase 2/3 metadata comment block.
 *
 * Requirements:
 * - "Windows Registry Editor Version 5.00" header
 * - a ; comment metadata block recording exact key paths, value names, hive and timestamp
 * - [HKEY_...] long-form section headers (HKEY_CURRENT_USER / HKEY_LOCAL_MACHINE)
 * - value lines escaped via buildRegSnippet
 * - CRLF line endings
 */
export function formatRegistryFixerBackup(
  entries: RegistryBackupEntry[],
  timestamp: string = new Date().toISOString()
): string {
  const HEADER = 'Windows Registry Editor Version 5.00';
  const targetLines = entries.map((e) =>
    e.type === 'orphaned_uninstall'
      ? `;   ${e.hive}\\${e.keyPath}`
      : `;   ${e.hive}\\${e.keyPath} -> "${e.valueName}"`
  );

  const hives = Array.from(new Set(entries.map((e) => e.hive))).join(', ') || 'HKCU';

  const commentLines = [
    '; DeskKlean Backup Metadata',
    '; Module: registry-fixer',
    `; Timestamp: ${timestamp}`,
    `; Hive: ${hives}`,
    `; Issues backed up: ${entries.length}`,
    '; Targets:',
    ...targetLines,
  ].join('\r\n');

  const snippets = entries.map(buildBackupSnippet);
  const merged = mergeRegSnippets(snippets);
  const headerWithNewline = `${HEADER}\r\n\r\n`;

  if (merged.startsWith(headerWithNewline)) {
    return `${HEADER}\r\n\r\n${commentLines}\r\n\r\n${merged.slice(headerWithNewline.length)}`;
  }
  return `${HEADER}\r\n\r\n${commentLines}\r\n\r\n${merged}`;
}

/**
 * Writes a .reg backup file as UTF-16LE with BOM (\uFEFF) and CRLF line endings.
 * Re-reads and asserts BOM bytes FF FE.
 */
export function writeRegistryFixerBackupFile(
  filePath: string,
  content: string
): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Write file as UTF-16LE WITH a BOM (\uFEFF)
  fs.writeFileSync(filePath, '\uFEFF' + content, { encoding: 'utf16le' });

  // Re-read and assert BOM bytes FF FE
  const headerCheck = Buffer.alloc(2);
  const fd = fs.openSync(filePath, 'r');
  fs.readSync(fd, headerCheck, 0, 2, 0);
  fs.closeSync(fd);

  if (headerCheck[0] !== 0xff || headerCheck[1] !== 0xfe) {
    throw new Error('Backup file BOM check failed: first bytes are not FF FE');
  }
}

/**
 * Validates a written .reg backup file before any deletion is allowed to occur.
 *
 * Requirements:
 * 1. File exists.
 * 2. UTF-16LE BOM (first bytes FF FE) is present.
 * 3. File starts with "Windows Registry Editor Version 5.00".
 * 4. File contains CRLF line endings.
 * 5. File contains parseable [HKEY_...] section headers.
 */
export function validateRegBackupFile(filePath: string): BackupValidationResult {
  if (!fs.existsSync(filePath)) {
    return { valid: false, reason: `Backup file does not exist: ${filePath}` };
  }

  let buffer: Buffer;
  try {
    buffer = fs.readFileSync(filePath);
  } catch (err) {
    return {
      valid: false,
      reason: `Failed to read backup file: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (buffer.length < 2) {
    return { valid: false, reason: 'Backup file is too small (empty or corrupt)' };
  }

  // BOM check: UTF-16LE BOM is 0xFF 0xFE
  if (buffer[0] !== 0xff || buffer[1] !== 0xfe) {
    return {
      valid: false,
      reason: 'Backup file is missing UTF-16LE BOM (first bytes are not FF FE)',
    };
  }

  let cleanText: string;
  try {
    const text = buffer.toString('utf16le');
    cleanText = text.replace(/^\uFEFF/, '').trimStart();
  } catch (err) {
    return {
      valid: false,
      reason: `Failed to decode UTF-16LE text: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (!cleanText.startsWith('Windows Registry Editor Version 5.00')) {
    return {
      valid: false,
      reason: 'Invalid header: missing "Windows Registry Editor Version 5.00"',
    };
  }

  // Check CRLF
  if (!cleanText.includes('\r\n')) {
    return { valid: false, reason: 'Backup file does not have CRLF line endings' };
  }

  // Check parseable section headers
  const sectionHeaderRegex = /^\[(HKEY_LOCAL_MACHINE|HKEY_CURRENT_USER)[^\]]*\]/m;
  if (!sectionHeaderRegex.test(cleanText)) {
    return {
      valid: false,
      reason: 'Backup file contains no valid registry key section headers ([HKEY_...])',
    };
  }

  return { valid: true };
}

/**
 * Reads all values of a subkey with their types on Windows.
 */
export async function readSubKeyValuesWithTypes(
  hive: RegistryHive,
  keyPath: string
): Promise<Array<{ name: string; type: string; data: unknown }>> {
  if (!isWindows()) {
    return [];
  }
  const cleanPath = keyPath
    .replace(/^(HKCU:|HKLM:|HKEY_CURRENT_USER|HKEY_LOCAL_MACHINE)[\\\/]*/i, '')
    .replace(/^[\\\/]+/, '');
  const psPath = `${hive}:\\${cleanPath}`;
  const escapedPath = psPath.replace(/'/g, "''");

  const script = `
    $p = '${escapedPath}';
    if (Test-Path -LiteralPath $p) {
      $k = Get-Item -LiteralPath $p -ErrorAction SilentlyContinue;
      if ($k) {
        $names = @($k.GetValueNames());
        $list = @($names | ForEach-Object {
          [PSCustomObject]@{
            name = $_;
            type = $k.GetValueKind($_).ToString();
            data = $k.GetValue($_);
          }
        });
        if ($list.Count -gt 0) {
          $list | ConvertTo-Json -Depth 4 -Compress
        } else {
          '[]'
        }
      } else {
        '[]'
      }
    } else {
      '[]'
    }
  `.trim();

  try {
    const raw = await runPowerShell(script);
    const parsed = parseJsonSafe<unknown>(raw, [], 'backup:readSubKeyValuesWithTypes');
    if (Array.isArray(parsed)) {
      return parsed.map((item: any) => ({
        name: String(item?.name ?? ''),
        type: String(item?.type ?? 'String'),
        data: item?.data,
      }));
    } else if (parsed && typeof parsed === 'object') {
      const item = parsed as any;
      return [
        {
          name: String(item?.name ?? ''),
          type: String(item?.type ?? 'String'),
          data: item?.data,
        },
      ];
    }
    return [];
  } catch (err) {
    console.warn(`Failed to read subkey values with types for ${psPath}:`, err);
    return [];
  }
}
