// scripts/test-reg-escaper.mjs
// Test runner for escapeRegString (.reg string escaper).
//
// Choice: This script re-implements the two escaping rules inline (as permitted by spec),
// importing nothing from the project so it can be run directly with `node scripts/test-reg-escaper.mjs`.
//
// Rules implemented:
// 1. backslash -> \\
// 2. double-quote -> \"
// Order matters: escape backslashes FIRST, then quotes, or you double-escape.

export function escapeRegString(value) {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

const testCases = [
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

let failedCount = 0;

console.log('Running test-reg-escaper test suite:\n');

for (const tc of testCases) {
  const actual = escapeRegString(tc.input);
  if (actual === tc.expected) {
    console.log(`[PASS] ${tc.name}`);
  } else {
    failedCount++;
    console.error(`[FAIL] ${tc.name}`);
    console.error(`       Input:    ${JSON.stringify(tc.input)}`);
    console.error(`       Expected: ${JSON.stringify(tc.expected)}`);
    console.error(`       Actual:   ${JSON.stringify(actual)}`);
  }
}

console.log(`\nResults: ${testCases.length - failedCount}/${testCases.length} tests passed.`);

if (failedCount > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
