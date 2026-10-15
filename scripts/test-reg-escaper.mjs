// scripts/test-reg-escaper.mjs
// Test runner for escapeRegString and buildRegSnippet (.reg snippet generator).

import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

let buildRegSnippet, escapeRegString, mergeRegSnippets;

try {
  const reg = require('../dist/main/system/registry.js');
  buildRegSnippet = reg.buildRegSnippet;
  escapeRegString = reg.escapeRegString;
  mergeRegSnippets = reg.mergeRegSnippets;
} catch {
  // Try building dist if missing
  try {
    const { execSync } = require('child_process');
    execSync('npx tsc -p tsconfig.main.json', { cwd: path.resolve(__dirname, '..'), stdio: 'ignore' });
    const reg = require('../dist/main/system/registry.js');
    buildRegSnippet = reg.buildRegSnippet;
    escapeRegString = reg.escapeRegString;
    mergeRegSnippets = reg.mergeRegSnippets;
  } catch (err) {
    console.error('Failed to load or compile dist/main/system/registry.js:', err);
    process.exit(1);
  }
}

export { escapeRegString, buildRegSnippet, mergeRegSnippets };

let failedCount = 0;

function assert(condition, name, details = '') {
  if (condition) {
    console.log(`[PASS] ${name}`);
  } else {
    failedCount++;
    console.error(`[FAIL] ${name}`);
    if (details) {
      console.error(`       ${details}`);
    }
  }
}

console.log('=== Running escapeRegString Test Suite ===\n');

const escaperTestCases = [
  {
    name: 'plain -> unchanged',
    input: 'plain',
    expected: 'plain',
  },
  {
    name: 'C:\\Program Files\\App\\app.exe -> backslashes doubled',
    input: 'C:\\Program Files\\App\\app.exe',
    expected: 'C:\\\\Program Files\\\\App\\\\app.exe',
  },
  {
    name: '"C:\\Program Files\\App\\app.exe" -> backslashes doubled AND quotes escaped',
    input: '"C:\\Program Files\\App\\app.exe"',
    expected: '\\"C:\\\\Program Files\\\\App\\\\app.exe\\"',
  },
  {
    name: 'a "quoted" word -> quotes escaped',
    input: 'a "quoted" word',
    expected: 'a \\"quoted\\" word',
  },
  {
    name: 'a\\\\b -> no double-escaping',
    input: 'a\\\\b',
    expected: 'a\\\\\\\\b',
  },
  {
    name: 'trailing backslash "C:\\" -> doubled, no dangling escape',
    input: '"C:\\"',
    expected: '\\"C:\\\\\\"',
  },
];

for (const tc of escaperTestCases) {
  const actual = escapeRegString(tc.input);
  assert(
    actual === tc.expected,
    tc.name,
    `Expected ${JSON.stringify(tc.expected)}, got ${JSON.stringify(actual)}`
  );
}

console.log('\n=== Running buildRegSnippet Test Suite ===\n');

// 1. REG_SZ plain -> "name"="value"
{
  const snippet = buildRegSnippet('HKCU', 'Software\\Test', 'app', 'myvalue', 'REG_SZ');
  const lines = snippet.split('\r\n');
  const valueLine = lines[3];
  assert(
    valueLine === '"app"="myvalue"',
    '1. REG_SZ plain -> "name"="value"',
    `Expected '"app"="myvalue"', got ${JSON.stringify(valueLine)}`
  );

  const defaultSnippet = buildRegSnippet('HKCU', 'Software\\Test', 'app', 'myvalue');
  const defaultValLine = defaultSnippet.split('\r\n')[3];
  assert(
    defaultValLine === '"app"="myvalue"',
    '1b. REG_SZ (default when omitted) -> "name"="value"',
    `Expected '"app"="myvalue"', got ${JSON.stringify(defaultValLine)}`
  );
}

// 2. REG_SZ with backslashes and quotes -> still escaped correctly
{
  const snippet = buildRegSnippet(
    'HKCU',
    'Software\\Test',
    'app',
    '"C:\\Program Files\\App\\app.exe"',
    'REG_SZ'
  );
  const lines = snippet.split('\r\n');
  const valueLine = lines[3];
  assert(
    valueLine === '"app"="\\"C:\\\\Program Files\\\\App\\\\app.exe\\""',
    '2. REG_SZ with backslashes and quotes -> escaped correctly',
    `Got ${JSON.stringify(valueLine)}`
  );
}

// 3. REG_EXPAND_SZ '%ProgramFiles%\A' -> "name"=hex(2):25,00,50,00,72,00,... ,00,00
{
  const inputStr = '%ProgramFiles%\\A';
  const snippet = buildRegSnippet('HKCU', 'Software\\Test', 'exp', inputStr, 'REG_EXPAND_SZ');
  const lines = snippet.split('\r\n');
  const valueLine = lines[3];

  const prefix = '"exp"=hex(2):';
  const startsCorrectly = valueLine.startsWith(prefix);
  const hexPart = valueLine.slice(prefix.length);
  const byteTokens = hexPart.split(',');
  const expectedByteCount = 2 * inputStr.length + 2; // 16 * 2 + 2 = 34
  const hasCorrectLength = byteTokens.length === expectedByteCount;
  const endsWithNullTerminator =
    byteTokens.length >= 2 &&
    byteTokens[byteTokens.length - 2] === '00' &&
    byteTokens[byteTokens.length - 1] === '00';
  const startsWithCorrectBytes =
    byteTokens.length >= 2 && byteTokens[0] === '25' && byteTokens[1] === '00';

  assert(
    startsCorrectly && hasCorrectLength && endsWithNullTerminator && startsWithCorrectBytes,
    '3. REG_EXPAND_SZ \'%ProgramFiles%\\A\' -> "name"=hex(2):... (length 2*n+2 with 00,00 terminator)',
    `Length: ${byteTokens.length} (expected ${expectedByteCount}), trailing: ${byteTokens.slice(-2).join(',')}, line: ${valueLine}`
  );
}

// 4. REG_BINARY from number[] -> "name"=hex:02,00,00,00,... (12 bytes)
let snippetBinaryArray = '';
{
  const bytes = [2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  snippetBinaryArray = buildRegSnippet('HKCU', 'Software\\Test', 'bin', bytes, 'REG_BINARY');
  const lines = snippetBinaryArray.split('\r\n');
  const valueLine = lines[3];
  const expectedLine = '"bin"=hex:02,00,00,00,00,00,00,00,00,00,00,00';
  const hexTokens = valueLine.replace('"bin"=hex:', '').split(',');
  assert(
    valueLine === expectedLine && hexTokens.length === 12,
    '4. REG_BINARY from number[] -> "name"=hex:02,00,00,00,... (12 bytes)',
    `Expected ${expectedLine}, got ${JSON.stringify(valueLine)}`
  );
}

// 5. REG_BINARY from a hex string -> identical output to case 4
{
  const hexStr = '02,00,00,00,00,00,00,00,00,00,00,00';
  const snippetBinaryString = buildRegSnippet('HKCU', 'Software\\Test', 'bin', hexStr, 'REG_BINARY');
  assert(
    snippetBinaryString === snippetBinaryArray,
    '5. REG_BINARY from a hex string -> identical output to case 4',
    `Outputs differed:\nArray:  ${JSON.stringify(snippetBinaryArray)}\nString: ${JSON.stringify(snippetBinaryString)}`
  );
}

// 6. REG_DWORD 1 -> "name"=dword:01000000
{
  const snippet = buildRegSnippet('HKCU', 'Software\\Test', 'dw', 1, 'REG_DWORD');
  const lines = snippet.split('\r\n');
  const valueLine = lines[3];
  const expected = '"dw"=dword:01000000';
  assert(
    valueLine === expected,
    '6. REG_DWORD 1 -> "name"=dword:01000000',
    `Expected ${expected}, got ${JSON.stringify(valueLine)}`
  );
}

// 7. DELETE -> "name"=-
{
  const snippet = buildRegSnippet('HKCU', 'Software\\Test', 'delItem', undefined, 'DELETE');
  const lines = snippet.split('\r\n');
  const valueLine = lines[3];
  const expected = '"delItem"=-';
  assert(
    valueLine === expected,
    '7. DELETE -> "name"=-',
    `Expected ${expected}, got ${JSON.stringify(valueLine)}`
  );
}

// 8. default value name '' or '@' -> @=
{
  const snippetEmpty = buildRegSnippet('HKCU', 'Software\\Test', '', 'val', 'REG_SZ');
  const valEmpty = snippetEmpty.split('\r\n')[3];
  const snippetAt = buildRegSnippet('HKCU', 'Software\\Test', '@', 'val', 'REG_SZ');
  const valAt = snippetAt.split('\r\n')[3];
  const snippetDelete = buildRegSnippet('HKCU', 'Software\\Test', '', undefined, 'DELETE');
  const valDelete = snippetDelete.split('\r\n')[3];

  assert(
    valEmpty === '@="val"' && valAt === '@="val"' && valDelete === '@=-',
    '8. default value name \'\' or \'@\' -> @=',
    `valEmpty: ${valEmpty}, valAt: ${valAt}, valDelete: ${valDelete}`
  );
}

// 9. The header uses the LONG hive name (HKEY_CURRENT_USER / HKEY_LOCAL_MACHINE)
{
  const hkcuSnippet = buildRegSnippet('HKCU', 'Software\\Test', 'k', 'v');
  const hklmSnippet = buildRegSnippet('HKLM', 'Software\\Test', 'k', 'v');

  const hkcuHeader = hkcuSnippet.split('\r\n')[2];
  const hklmHeader = hklmSnippet.split('\r\n')[2];

  assert(
    hkcuHeader === '[HKEY_CURRENT_USER\\Software\\Test]' &&
    hklmHeader === '[HKEY_LOCAL_MACHINE\\Software\\Test]',
    '9. The header uses the LONG hive name (HKEY_CURRENT_USER / HKEY_LOCAL_MACHINE)',
    `HKCU: ${hkcuHeader}, HKLM: ${hklmHeader}`
  );
}

// 10. Line endings are CRLF
{
  const snippet = buildRegSnippet('HKCU', 'Software\\Test', 'item', 'value');
  const hasCrlf = snippet.includes('\r\n');
  const hasNoBareLf = !/[^\r]\n/.test(snippet);
  const endsWithCrlf = snippet.endsWith('\r\n');

  assert(
    hasCrlf && hasNoBareLf && endsWithCrlf,
    '10. Line endings are CRLF',
    `hasCrlf: ${hasCrlf}, hasNoBareLf: ${hasNoBareLf}, endsWithCrlf: ${endsWithCrlf}`
  );
}

// 11. Merging snippets under single header
{
  const s1 = buildRegSnippet(
    'HKCU',
    'SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run',
    'MyApp',
    '%ProgramFiles%\\MyApp\\app.exe',
    'REG_EXPAND_SZ'
  );
  const s2 = buildRegSnippet(
    'HKCU',
    'SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run',
    'MyApp',
    undefined,
    'DELETE'
  );
  const merged = mergeRegSnippets([s1, s2]);

  const headerMatches = (merged.match(/Windows Registry Editor Version 5\.00/g) || []).length;
  const hasKey1 = merged.includes('[HKEY_CURRENT_USER\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run]');
  const hasKey2 = merged.includes('[HKEY_CURRENT_USER\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run]');
  const hasExpand = merged.includes('"MyApp"=hex(2):');
  const hasDelete = merged.includes('"MyApp"=-');
  const hasNoBareLf = !/[^\r]\n/.test(merged);

  assert(
    headerMatches === 1 && hasKey1 && hasKey2 && hasExpand && hasDelete && hasNoBareLf,
    '11. mergeRegSnippets merges documents under single header without regex stripping',
    `headerMatches: ${headerMatches}, hasKey1: ${hasKey1}, hasKey2: ${hasKey2}, hasExpand: ${hasExpand}, hasDelete: ${hasDelete}`
  );
}

console.log(`\nTest suite complete: ${failedCount === 0 ? 'ALL PASSED' : `${failedCount} FAILED`}.`);

if (failedCount > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
