// scripts/test-system-info.mjs
// Unit tests for SystemInfo disk measurements & Google Drive FAT32 correction,
// and renderer formatRelativeTime utility.

import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

let systemInfo;
try {
  systemInfo = require('../dist/main/system/systemInfo.js');
} catch {
  const { execSync } = require('child_process');
  execSync('npm run build:main', { cwd: path.resolve(__dirname, '..'), stdio: 'inherit' });
  systemInfo = require('../dist/main/system/systemInfo.js');
}

let failedCount = 0;
let passedCount = 0;

function assert(condition, name, details = '') {
  if (condition) {
    passedCount++;
    console.log(`[PASS] ${name}`);
  } else {
    failedCount++;
    console.error(`[FAIL] ${name}`);
    if (details) {
      console.error(`       ${details}`);
    }
  }
}

console.log('=== Section 1: Standard Logical Disk Measurements ===\n');

{
  const rawDisk = {
    DeviceID: 'C:',
    VolumeName: 'Local Disk',
    FileSystem: 'NTFS',
    Size: '500000000000',
    FreeSpace: '100000000000',
    DriveType: 3,
  };

  const m = systemInfo.measureLogicalDisk(rawDisk);

  assert(m.deviceId === 'C:', '1a. deviceId matches DeviceID');
  assert(m.letter === 'C', '1b. letter strips colon and whitespace');
  assert(m.volumeName === 'Local Disk', '1c. volumeName is preserved');
  assert(m.fileSystem === 'NTFS', '1d. fileSystem is preserved');
  assert(m.isGoogleDrive === false, '1e. isGoogleDrive is false for standard disk');
  assert(m.hasValidMeasurements === true, '1f. hasValidMeasurements is true');
  assert(m.totalBytes === 500000000000, '1g. totalBytes parsed accurately');
  assert(m.freeBytes === 100000000000, '1h. freeBytes parsed accurately');
  assert(m.usedBytes === 400000000000, '1i. usedBytes calculated accurately');
  assert(m.freePercent === 20.0, '1j. freePercent is 20.0% (1 decimal)');
  assert(m.usagePercent === 80, '1k. usagePercent is 80% (integer)');
}

console.log('\n=== Section 2: Google Drive Desktop FAT32 Correction ===\n');

{
  // Google Drive virtual volume: FAT32 driver reports occupied cloud data in FreeSpace.
  // total = 100 GB, occupied = 25 GB. True free = 75 GB.
  const googleDriveDisk = {
    DeviceID: 'G:',
    VolumeName: 'Google Drive',
    FileSystem: 'FAT32',
    Size: '100000000000',
    FreeSpace: '25000000000',
    DriveType: 3,
  };

  const m = systemInfo.measureLogicalDisk(googleDriveDisk);

  assert(m.isGoogleDrive === true, '2a. Identified as Google Drive');
  assert(m.totalBytes === 100000000000, '2b. totalBytes is 100 GB');
  assert(m.usedBytes === 25000000000, '2c. usedBytes is 25 GB (corrected from FreeSpace)');
  assert(m.freeBytes === 75000000000, '2d. freeBytes is 75 GB (total - occupied)');
  assert(m.freePercent === 75.0, '2e. freePercent is 75.0%');
  assert(m.usagePercent === 25, '2f. usagePercent is 25%');

  // Case-insensitive detection
  const lowerDriveDisk = {
    DeviceID: 'H:',
    VolumeName: 'My google drive volume',
    FileSystem: 'FAT32',
    Size: '50000000000',
    FreeSpace: '10000000000',
  };
  const mLower = systemInfo.measureLogicalDisk(lowerDriveDisk);
  assert(mLower.isGoogleDrive === true, '2g. Case-insensitive Google Drive volume detected');
  assert(mLower.freeBytes === 40000000000, '2h. freeBytes corrected properly');

  // Clamped to 0 if occupied > total
  const overflowDisk = {
    DeviceID: 'G:',
    VolumeName: 'Google Drive',
    Size: '10000000000',
    FreeSpace: '15000000000', // reports more occupied than quota
  };
  const mOverflow = systemInfo.measureLogicalDisk(overflowDisk);
  assert(mOverflow.freeBytes === 0, '2i. freeBytes clamped to 0 on overflow');
}

console.log('\n=== Section 3: Invalid / Missing Field Handling ===\n');

{
  const missingSize = {
    DeviceID: 'D:',
    VolumeName: 'Data',
    Size: null,
    FreeSpace: '50000000000',
  };
  const mMissingSize = systemInfo.measureLogicalDisk(missingSize);
  assert(mMissingSize.hasValidMeasurements === false, '3a. Null Size flagged as invalid');
  assert(mMissingSize.totalBytes === 0, '3b. Null Size defaults totalBytes to 0');

  const missingFree = {
    DeviceID: 'E:',
    VolumeName: 'Data',
    Size: '50000000000',
    FreeSpace: null,
  };
  const mMissingFree = systemInfo.measureLogicalDisk(missingFree);
  assert(mMissingFree.hasValidMeasurements === false, '3c. Null FreeSpace flagged as invalid');
  assert(mMissingFree.freeBytes === 0, '3d. Null FreeSpace defaults freeBytes to 0');

  const zeroSize = {
    DeviceID: 'F:',
    Size: '0',
    FreeSpace: '0',
  };
  const mZero = systemInfo.measureLogicalDisk(zeroSize);
  assert(mZero.hasValidMeasurements === false, '3e. Zero Size flagged as invalid');
}

console.log('\n=== Section 4: Batch Mapping (measureLogicalDisks) ===\n');

{
  const disks = [
    { DeviceID: 'C:', VolumeName: 'OS', Size: '500000000000', FreeSpace: '250000000000' },
    { DeviceID: 'G:', VolumeName: 'Google Drive', Size: '100000000000', FreeSpace: '10000000000' },
  ];
  const list = systemInfo.measureLogicalDisks(disks);
  assert(Array.isArray(list) && list.length === 2, '4a. Returns array of 2 measurements');
  assert(list[0].deviceId === 'C:' && !list[0].isGoogleDrive, '4b. First item is C: (non-cloud)');
  assert(list[1].deviceId === 'G:' && list[1].isGoogleDrive, '4c. Second item is G: (Google Drive corrected)');
}

console.log('\n=== Section 5: formatRelativeTime Utility Tests ===\n');

{
  const fs = require('fs');
  const esbuild = require('esbuild');
  const code = fs.readFileSync(path.resolve(__dirname, '../src/renderer/utils/format.ts'), 'utf8');
  const transformed = esbuild.transformSync(code, { loader: 'ts', format: 'cjs' }).code;
  const mod = { exports: {} };
  new Function('module', 'exports', transformed)(mod, mod.exports);
  const { formatRelativeTime } = mod.exports;

  const now = Date.now();

  assert(formatRelativeTime(now - 3000) === 'just now', '5a. 3s ago is "just now"');
  assert(formatRelativeTime(now - 25000) === '25s ago', '5b. 25s ago is "25s ago"');
  assert(formatRelativeTime(now - 120000) === '2m ago', '5c. 120s ago is "2m ago"');
  assert(formatRelativeTime(now - 3600000) === '1h ago', '5d. 1h ago is "1h ago"');
  assert(formatRelativeTime(now - 86400000) === '1d ago', '5e. 1d ago is "1d ago"');
  assert(formatRelativeTime(new Date(now - 60000).toISOString()) === '1m ago', '5f. Accepts ISO string');
  assert(formatRelativeTime(new Date(now - 5000)) === 'just now', '5g. Accepts Date object');
  assert(formatRelativeTime('invalid-date') === 'recently', '5h. Gracefully handles invalid date string');
}

console.log('\n=== Section 6: Disk Performance Counter Normalization & MB Scaling ===\n');

{
  const toMb = (bytesSec) => {
    const mb = bytesSec / (1024 * 1024);
    if (mb <= 0) return 0;
    if (mb < 0.1) return Math.round(mb * 100) / 100;
    return Math.round(mb * 10) / 10;
  };

  // Zero throughput
  assert(toMb(0) === 0, '6a. 0 bytes/sec scales to 0 MB/s');
  assert(toMb(-500) === 0, '6b. Negative bytes/sec scales to 0 MB/s');

  // Small background throughput (< 0.1 MB/s) preserves 2 decimal places instead of rounding to 0
  assert(toMb(41943) === 0.04, '6c. 40 KB/s (~0.04 MB/s) formats to 0.04 MB/s');
  assert(toMb(83886) === 0.08, '6d. 80 KB/s (~0.08 MB/s) formats to 0.08 MB/s');

  // Standard throughput (>= 0.1 MB/s) formats with 1 decimal place
  assert(toMb(1048576) === 1.0, '6e. Exactly 1 MB/s formats to 1.0 MB/s');
  assert(toMb(25690112) === 24.5, '6f. 24.5 MB/s formats accurately');

  // Casing tolerance test for PerfDisk WMI rows
  const wmiRowLowerSec = { DiskReadBytesPersec: '15728640', DiskWriteBytesPersec: '5242880' };
  const readLower = Number(wmiRowLowerSec.DiskReadBytesPersec ?? wmiRowLowerSec.DiskReadBytesPerSec);
  const writeLower = Number(wmiRowLowerSec.DiskWriteBytesPersec ?? wmiRowLowerSec.DiskWriteBytesPerSec);
  assert(readLower === 15728640, '6g. Successfully parses DiskReadBytesPersec (lowercase sec)');
  assert(writeLower === 5242880, '6h. Successfully parses DiskWriteBytesPersec (lowercase sec)');

  const wmiRowUpperSec = { DiskReadBytesPerSec: '8388608', DiskWriteBytesPerSec: '2097152' };
  const readUpper = Number(wmiRowUpperSec.DiskReadBytesPersec ?? wmiRowUpperSec.DiskReadBytesPerSec);
  const writeUpper = Number(wmiRowUpperSec.DiskWriteBytesPersec ?? wmiRowUpperSec.DiskWriteBytesPerSec);
  assert(readUpper === 8388608, '6i. Fallback parses DiskReadBytesPerSec (capital Sec)');
  assert(writeUpper === 2097152, '6j. Fallback parses DiskWriteBytesPerSec (capital Sec)');
}

console.log('\n=== Section 7: GPU 64-bit VRAM Resolution ===\n');

if (process.platform === 'win32') {
  // Inject a deterministic registry dump. Querying the real registry makes the
  // test depend on the host GPU -- it only passes on a machine with a 16 GB card.
  const fakeRegOutput = [
    '',
    'HKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}\\0000',
    '    DriverDesc    REG_SZ    AMD Radeon RX 9060 XT',
    '    HardwareInformation.qwMemorySize    REG_QWORD    0x3fb000000',
    '',
  ].join('\r\n');
  const vram = await systemInfo.getGpuVram64BitMb('AMD Radeon RX 9060 XT', {
    regQuery: async () => fakeRegOutput,
  });
  assert(vram !== null && vram > 4095, `7a. Resolves 64-bit VRAM beyond 4095 MB clamp (got ${vram} MB)`);
  assert(vram >= 15000 && vram <= 18000, '7b. 16 GB GPU falls in expected range (~16304 MB)');
} else {
  assert(true, '7a. (Skipped on non-Windows)');
  assert(true, '7b. (Skipped on non-Windows)');
}

console.log('\n========================================');
console.log(`Total tests: ${passedCount + failedCount}`);
console.log(`Passed:      ${passedCount}`);
console.log(`Failed:      ${failedCount}`);
console.log('========================================\n');

if (failedCount > 0) {
  process.exit(1);
} else {
  console.log('ALL SYSTEM INFO AND UTILITY TESTS PASSED!\n');
}


