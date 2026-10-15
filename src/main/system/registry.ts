import { runPowerShell, parseJsonSafe, isWindows } from './powershell';

export type RegistryHive = 'HKCU' | 'HKLM';

export interface ReadValueResult {
  exists: boolean;
  type?: string;
  data?: unknown;
}

export const STARTUP_APPROVED_LENGTH = 12;
export const STARTUP_APPROVED_ENABLED = 0x02;
export const STARTUP_APPROVED_DISABLED = 0x03;

/**
 * Normalizes a hive and keyPath into a PowerShell PSDrive path (e.g. 'HKCU:\Software\...').
 */
function toPsDrivePath(hive: RegistryHive, keyPath: string): string {
  const cleanPath = keyPath
    .replace(/^(HKCU:|HKLM:|HKEY_CURRENT_USER|HKEY_LOCAL_MACHINE)[\\\/]*/i, '')
    .replace(/^[\\\/]+/, '');
  return `${hive}:\\${cleanPath}`;
}

/**
 * Escapes single quotes for PowerShell single-quoted string literals.
 */
function escapePsSingleQuote(str: string): string {
  return str.replace(/'/g, "''");
}

/**
 * Reads all values in a registry key, returning a key-value record.
 * Registry access uses PowerShell cmdlets with typed JSON output.
 * Returns {} (not an error) when the key does not exist.
 *
 * @param hive - Registry hive ('HKCU' or 'HKLM').
 * @param keyPath - Path to the key.
 * @returns Map of value names to their typed values.
 */
export async function readKeyValues(
  hive: RegistryHive,
  keyPath: string
): Promise<Record<string, unknown>> {
  if (!isWindows()) {
    throw new Error('Windows-only operation');
  }

  const psPath = toPsDrivePath(hive, keyPath);
  const escapedPath = escapePsSingleQuote(psPath);

  const script = `
    $p = '${escapedPath}';
    if (Test-Path -LiteralPath $p) {
      $item = Get-ItemProperty -LiteralPath $p -ErrorAction SilentlyContinue |
        Select-Object -Property * -ExcludeProperty PS*;
      if ($null -ne $item) {
        $item | ConvertTo-Json -Depth 4 -Compress
      } else {
        '{}'
      }
    } else {
      '{}'
    }
  `.trim();

  try {
    const raw = await runPowerShell(script);
    const parsed = parseJsonSafe<unknown>(raw, {}, 'registry:readKeyValues');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch (err) {
    console.warn(`Failed to read registry key values for ${psPath}:`, err);
    return {};
  }
}

/**
 * Reads a single value from a registry key.
 * Returns { exists: false } when absent — never throws for a missing value.
 *
 * @param hive - Registry hive ('HKCU' or 'HKLM').
 * @param keyPath - Path to the key.
 * @param name - Name of the value to read.
 * @returns Object with exists boolean and optional type & data.
 */
export async function readValue(
  hive: RegistryHive,
  keyPath: string,
  name: string
): Promise<ReadValueResult> {
  if (!isWindows()) {
    throw new Error('Windows-only operation');
  }

  const psPath = toPsDrivePath(hive, keyPath);
  const escapedPath = escapePsSingleQuote(psPath);
  const escapedName = escapePsSingleQuote(name);

  const script = `
    $p = '${escapedPath}';
    $n = '${escapedName}';
    if (Test-Path -LiteralPath $p) {
      $k = Get-Item -LiteralPath $p -ErrorAction SilentlyContinue;
      if ($k) {
        $names = @($k.GetValueNames());
        if ($names -contains $n -or ($n -eq '' -and $names -contains '')) {
          $kind = $k.GetValueKind($n).ToString();
          $val = $k.GetValue($n);
          [PSCustomObject]@{ exists = $true; type = $kind; data = $val } | ConvertTo-Json -Depth 4 -Compress
        } else {
          '{"exists":false}'
        }
      } else {
        '{"exists":false}'
      }
    } else {
      '{"exists":false}'
    }
  `.trim();

  try {
    const raw = await runPowerShell(script);
    const parsed = parseJsonSafe<{ exists?: boolean; type?: string; data?: unknown }>(
      raw,
      { exists: false },
      'registry:readValue'
    );
    if (parsed && typeof parsed === 'object' && parsed.exists === true) {
      return {
        exists: true,
        type: typeof parsed.type === 'string' ? parsed.type : undefined,
        data: parsed.data,
      };
    }
    return { exists: false };
  } catch (err) {
    console.warn(`Failed to read registry value ${psPath}\\${name}:`, err);
    return { exists: false };
  }
}

/**
 * Checks if a registry key exists.
 *
 * @param hive - Registry hive ('HKCU' or 'HKLM').
 * @param keyPath - Path to the key.
 * @returns True if the key exists, false otherwise.
 */
export async function keyExists(
  hive: RegistryHive,
  keyPath: string
): Promise<boolean> {
  if (!isWindows()) {
    throw new Error('Windows-only operation');
  }

  const psPath = toPsDrivePath(hive, keyPath);
  const escapedPath = escapePsSingleQuote(psPath);

  const script = `
    $p = '${escapedPath}';
    if (Test-Path -LiteralPath $p) { 'true' } else { 'false' }
  `.trim();

  try {
    const raw = await runPowerShell(script);
    return raw.trim().toLowerCase() === 'true';
  } catch (err) {
    console.warn(`Failed to check if key exists ${psPath}:`, err);
    return false;
  }
}

/**
 * Lists the subkey names under a given registry key.
 *
 * @param hive - Registry hive ('HKCU' or 'HKLM').
 * @param keyPath - Path to the parent key.
 * @returns Array of subkey name strings.
 */
export async function listSubKeys(
  hive: RegistryHive,
  keyPath: string
): Promise<string[]> {
  if (!isWindows()) {
    throw new Error('Windows-only operation');
  }

  const psPath = toPsDrivePath(hive, keyPath);
  const escapedPath = escapePsSingleQuote(psPath);

  const script = `
    $p = '${escapedPath}';
    if (Test-Path -LiteralPath $p) {
      $k = Get-Item -LiteralPath $p -ErrorAction SilentlyContinue;
      if ($k) {
        $subs = @($k.GetSubKeyNames());
        $subs | ConvertTo-Json -Compress
      } else {
        '[]'
      }
    } else {
      '[]'
    }
  `.trim();

  try {
    const raw = await runPowerShell(script);
    const parsed = parseJsonSafe<unknown>(raw, [], 'registry:listSubKeys');
    if (Array.isArray(parsed)) {
      return parsed.map((x) => String(x));
    }
    if (typeof parsed === 'string') {
      return [parsed];
    }
    return [];
  } catch (err) {
    console.warn(`Failed to list subkeys for ${psPath}:`, err);
    return [];
  }
}

/**
 * Decodes the Windows StartupApproved 12-byte REG_BINARY value.
 *
 * Format:
 * - 12-byte REG_BINARY
 * - data[0] is 0x02 for enabled, 0x03 for disabled
 * - Disabled condition: (data[0] & 0x01) !== 0 (the low bit of the first byte)
 * - data[4..11] holds little-endian FILETIME of when it was disabled
 * - A MISSING, null, or empty value means ENABLED (never toggled)
 * - Normalizes defensively across arrays, buffers, base64 strings, or objects.
 * - On unrecognizable shapes, returns true (enabled) and logs a warning; never reports disabled on failure.
 *
 * @param data - The raw data returned by PowerShell or registry read.
 * @returns True if the startup item is enabled, false if disabled.
 */
export function decodeStartupApproved(data: unknown): boolean {
  if (data === null || data === undefined) {
    return true; // Missing or null means enabled
  }

  let bytes: number[] | null = null;

  if (Array.isArray(data)) {
    if (data.length === 0) {
      return true;
    }
    bytes = data.map((x) => Number(x));
  } else if (Buffer.isBuffer(data) || data instanceof Uint8Array) {
    if (data.length === 0) {
      return true;
    }
    bytes = Array.from(data);
  } else if (typeof data === 'string') {
    const trimmed = data.trim();
    if (trimmed.length === 0) {
      return true;
    }
    try {
      const isHex = /^[0-9a-fA-F\s]+$/.test(trimmed) && !trimmed.includes('=');
      const buf = Buffer.from(trimmed.replace(/\s+/g, ''), isHex ? 'hex' : 'base64');
      if (buf.length > 0) {
        bytes = Array.from(buf);
      }
    } catch {
      // ignore parse failure
    }
  } else if (typeof data === 'object') {
    const obj = data as Record<string, unknown>;
    if (Array.isArray(obj.data)) {
      bytes = obj.data.map((x) => Number(x));
    } else {
      const values = Object.values(obj);
      if (values.length > 0 && values.every((v) => typeof v === 'number' || !Number.isNaN(Number(v)))) {
        bytes = values.map((v) => Number(v));
      }
    }
  }

  if (!bytes || bytes.length === 0 || Number.isNaN(bytes[0])) {
    console.warn('Unrecognizable StartupApproved data shape; defaulting to enabled:', data);
    return true; // Never report an item as disabled on a parse failure
  }

  // An item is DISABLED when the low bit of the FIRST byte is set: (data[0] & 0x01) !== 0
  const firstByte = bytes[0];
  const isDisabled = (firstByte & 0x01) !== 0;
  return !isDisabled;
}

/**
 * Encodes the Windows StartupApproved 12-byte REG_BINARY value.
 *
 * - enabled:  12 bytes, [0]=0x02, rest 0
 * - disabled: 12 bytes, [0]=0x03, bytes 4..11 = FILETIME(now) little-endian
 *
 * @param enabled - Whether the item should be marked enabled.
 * @returns 12-byte number array.
 */
export function encodeStartupApproved(enabled: boolean): number[] {
  const bytes = new Array<number>(STARTUP_APPROVED_LENGTH).fill(0);
  if (enabled) {
    bytes[0] = STARTUP_APPROVED_ENABLED;
  } else {
    bytes[0] = STARTUP_APPROVED_DISABLED;
    // Bytes 4..11 hold little-endian FILETIME of when it was disabled
    // Windows FILETIME: 100-nanosecond intervals since January 1, 1601 UTC
    const filetime = BigInt(Date.now()) * 10000n + 116444736000000000n;
    for (let i = 0; i < 8; i++) {
      bytes[4 + i] = Number((filetime >> BigInt(i * 8)) & 0xffn);
    }
  }
  return bytes;
}

/**
 * Escapes a string for a Windows .reg value string.
 * Backslash -> \\, double-quote -> \".
 * Order matters: escape backslashes FIRST, then quotes, or you double-escape.
 *
 * @param value - The raw string value.
 * @returns Escaped string for .reg file.
 */
export function escapeRegString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export type RegValueType =
  | 'REG_SZ'
  | 'REG_EXPAND_SZ'
  | 'REG_BINARY'
  | 'REG_DWORD'
  | 'DELETE'
  | string;

/**
 * Normalizes registry value type strings (handles both Windows REG_* and .NET RegistryValueKind names).
 */
function normalizeValueType(
  type?: string
): 'REG_SZ' | 'REG_EXPAND_SZ' | 'REG_BINARY' | 'REG_DWORD' | 'DELETE' {
  if (!type) return 'REG_SZ';
  const upper = type.toUpperCase();
  if (upper === 'REG_EXPAND_SZ' || upper === 'EXPANDSTRING') return 'REG_EXPAND_SZ';
  if (upper === 'REG_BINARY' || upper === 'BINARY') return 'REG_BINARY';
  if (upper === 'REG_DWORD' || upper === 'DWORD') return 'REG_DWORD';
  if (upper === 'DELETE') return 'DELETE';
  if (upper === 'REG_SZ' || upper === 'STRING') return 'REG_SZ';
  return 'REG_SZ';
}

/**
 * Emits a complete .reg file document containing a single value or delete directive.
 * The header path uses the LONG form (HKEY_CURRENT_USER / HKEY_LOCAL_MACHINE).
 * All line endings are CRLF.
 *
 * @param hive - Registry hive ('HKCU' | 'HKLM').
 * @param keyPath - Path to the registry key.
 * @param name - Name of the value (empty string or '@' for default value).
 * @param value - Value data (string, number, byte array, Buffer, or Uint8Array).
 * @param valueType - Registry value type ('REG_SZ' | 'REG_EXPAND_SZ' | 'REG_BINARY' | 'REG_DWORD' | 'DELETE').
 * @returns Complete .reg document string with CRLF endings.
 */
export function buildRegSnippet(
  hive: RegistryHive,
  keyPath: string,
  name: string,
  value?: string | number[] | Uint8Array | Buffer | number | null,
  valueType?: RegValueType
): string {
  const longHive = hive === 'HKCU' ? 'HKEY_CURRENT_USER' : 'HKEY_LOCAL_MACHINE';
  const cleanPath = keyPath
    .replace(/^(HKCU:|HKLM:|HKEY_CURRENT_USER|HKEY_LOCAL_MACHINE)[\\\/]*/i, '')
    .replace(/^[\\\/]+/, '');

  const keyHeader = cleanPath ? `[${longHive}\\${cleanPath}]` : `[${longHive}]`;
  const prefix = name === '' || name === '@' ? '@=' : '"' + escapeRegString(name) + '"=';
  const type = normalizeValueType(valueType);

  let valueLine: string;

  switch (type) {
    case 'DELETE': {
      valueLine = `${prefix}-`;
      break;
    }
    case 'REG_DWORD': {
      const num = typeof value === 'number' ? value : Number(value ?? 0);
      const buf = Buffer.alloc(4);
      buf.writeUInt32LE(num >>> 0, 0);
      const dwordHex = buf.toString('hex').toLowerCase();
      valueLine = `${prefix}dword:${dwordHex}`;
      break;
    }
    case 'REG_BINARY': {
      let hex = '';
      if (Array.isArray(value)) {
        hex = value
          .map((b) => Number(b).toString(16).padStart(2, '0').toLowerCase())
          .join(',');
      } else if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
        hex = Array.from(value)
          .map((b) => b.toString(16).padStart(2, '0').toLowerCase())
          .join(',');
      } else if (typeof value === 'string') {
        const cleaned = value.replace(/^hex:/i, '').trim();
        if (cleaned.includes(',')) {
          hex = cleaned
            .split(',')
            .map((s) => s.trim().toLowerCase().padStart(2, '0'))
            .join(',');
        } else if (cleaned.length > 0 && /^[0-9a-fA-F]+$/.test(cleaned) && cleaned.length % 2 === 0) {
          const matched = cleaned.match(/.{1,2}/g) || [];
          hex = matched.map((s) => s.toLowerCase()).join(',');
        } else {
          hex = cleaned.toLowerCase();
        }
      }
      valueLine = `${prefix}hex:${hex}`;
      break;
    }
    case 'REG_EXPAND_SZ': {
      const str = typeof value === 'string' ? value : String(value ?? '');
      const buf = Buffer.concat([Buffer.from(str, 'utf16le'), Buffer.alloc(2)]);
      const hex = Array.from(buf)
        .map((b) => b.toString(16).padStart(2, '0').toLowerCase())
        .join(',');
      valueLine = `${prefix}hex(2):${hex}`;
      break;
    }
    case 'REG_SZ':
    default: {
      const str = typeof value === 'string' ? value : String(value ?? '');
      const escapedValue = escapeRegString(str);
      valueLine = `${prefix}"${escapedValue}"`;
      break;
    }
  }

  return [
    'Windows Registry Editor Version 5.00',
    '',
    keyHeader,
    valueLine,
    '',
  ].join('\r\n');
}

/**
 * Merges multiple .reg snippet documents under a single "Windows Registry Editor Version 5.00"
 * header, preserving section headers and value lines without using regex stripping.
 *
 * @param snippets - Array of .reg snippet strings produced by buildRegSnippet.
 * @returns Unified .reg file content with CRLF line endings.
 */
export function mergeRegSnippets(snippets: string[]): string {
  const HEADER = 'Windows Registry Editor Version 5.00';
  const sections: string[] = [];

  for (const snippet of snippets) {
    if (!snippet || !snippet.trim()) continue;
    const lines = snippet.split('\r\n');
    const keyIndex = lines.findIndex((l) => l.startsWith('['));
    if (keyIndex !== -1) {
      const sectionLines = lines.slice(keyIndex);
      while (sectionLines.length > 0 && sectionLines[sectionLines.length - 1] === '') {
        sectionLines.pop();
      }
      if (sectionLines.length > 0) {
        sections.push(sectionLines.join('\r\n'));
      }
    }
  }

  return [HEADER, '', sections.join('\r\n\r\n'), ''].join('\r\n');
}
