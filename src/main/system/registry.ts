import { runPowerShell, isWindows } from './powershell';

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
    if (!raw || raw.trim().length === 0) {
      return {};
    }
    const parsed = JSON.parse(raw);
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
    if (!raw || raw.trim().length === 0) {
      return { exists: false };
    }
    const parsed = JSON.parse(raw);
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
    if (!raw || raw.trim().length === 0) {
      return [];
    }
    const parsed = JSON.parse(raw);
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

/**
 * Emits a minimal .reg file string containing only one value.
 * The header path uses the LONG form (HKEY_CURRENT_USER / HKEY_LOCAL_MACHINE).
 * Back up one value, never the whole key.
 *
 * @param hive - 'HKCU' or 'HKLM'
 * @param keyPath - Path to the registry key
 * @param name - Name of the value (empty string or '@' for default value)
 * @param value - String value data
 * @param valueType - Optional value type (e.g. 'REG_SZ')
 * @returns Minimal .reg file contents.
 */
export function buildRegSnippet(
  hive: RegistryHive,
  keyPath: string,
  name: string,
  value: string,
  valueType?: string
): string {
  const longHive = hive === 'HKCU' ? 'HKEY_CURRENT_USER' : 'HKEY_LOCAL_MACHINE';
  const cleanPath = keyPath
    .replace(/^(HKCU:|HKLM:|HKEY_CURRENT_USER|HKEY_LOCAL_MACHINE)[\\\/]*/i, '')
    .replace(/^[\\\/]+/, '');

  const escapedValue = escapeRegString(value);
  const valueLine =
    name === '' || name === '@'
      ? `@="${escapedValue}"`
      : `"${escapeRegString(name)}"="${escapedValue}"`;

  return [
    'Windows Registry Editor Version 5.00',
    '',
    `[${longHive}\\${cleanPath}]`,
    valueLine,
    '',
  ].join('\r\n');
}
