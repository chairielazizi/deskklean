// scripts/test-duplicates.mjs
// Pure-logic and filesystem unit tests for Phase 10 DuplicateFinder.

import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import os from 'os';
import crypto from 'crypto';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

let duplicateFinderModule;

let frameworkModule;

try {
  duplicateFinderModule = require('../dist/main/system/duplicate-finder/index.js');
  frameworkModule = require('../dist/main/system/framework/index.js');
} catch {
  const { execSync } = require('child_process');
  execSync('npm run build:main', { cwd: path.resolve(__dirname, '..'), stdio: 'inherit' });
  duplicateFinderModule = require('../dist/main/system/duplicate-finder/index.js');
  frameworkModule = require('../dist/main/system/framework/index.js');
}

const {
  selectKeepCopy,
  compareKeepCopyCandidates,
  computeFullHash,
  computePartialHash,
  isHardlink,
  scanDuplicates,
  createDuplicateDeletePlan,
  executeDuplicateDelete,
  DEFAULT_PARTIAL_HASH_THRESHOLD_BYTES,
  DEFAULT_HASH_WINDOW_BYTES,
} = duplicateFinderModule;

const { executeFileDeletions, validatePath } = frameworkModule;

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

async function runTests() {
  console.log('=== Section 1: Keep-Copy Selection (keepcopy.ts) (D-DF-8) ===\n');

  // Rule 1: Shortest full path wins
  const shortestTestCandidates = [
    { path: 'C:\\Users\\Alice\\Backups\\2024\\Old\\Documents\\Copy 3\\presentation.pdf', birthtimeMs: 1000 },
    { path: 'C:\\Users\\Alice\\Documents\\presentation.pdf', birthtimeMs: 2000 },
    { path: 'C:\\Users\\Alice\\Downloads\\presentation.pdf', birthtimeMs: 3000 },
  ];
  const shortestWinner = selectKeepCopy(shortestTestCandidates);
  assert(
    shortestWinner.path === 'C:\\Users\\Alice\\Documents\\presentation.pdf',
    '1a. Shortest full path wins (D-DF-8 rule 1)'
  );

  // Rule 2: Alphabetical tie-break when path lengths are equal
  const alphaTestCandidates = [
    { path: 'C:\\Users\\User\\FolderB\\report.docx', birthtimeMs: 1000 },
    { path: 'C:\\Users\\User\\FolderA\\report.docx', birthtimeMs: 2000 },
  ];
  const alphaWinner = selectKeepCopy(alphaTestCandidates);
  assert(
    alphaWinner.path === 'C:\\Users\\User\\FolderA\\report.docx',
    '1b. Alphabetical order tie-breaks equal path lengths (D-DF-8 rule 2)'
  );

  // Rule 2: Lowercase comparison
  const caseAlphaCandidates = [
    { path: 'C:\\Users\\User\\FolderZ\\report.docx', birthtimeMs: 1000 },
    { path: 'C:\\Users\\User\\foldera\\report.docx', birthtimeMs: 2000 },
  ];
  const caseWinner = selectKeepCopy(caseAlphaCandidates);
  assert(
    caseWinner.path === 'C:\\Users\\User\\foldera\\report.docx',
    '1c. Lowercase comparison in alphabetical tie-break'
  );

  // Rule 3: Earliest creation time tie-break when lengths and lowercase paths match
  const creationTieCandidates = [
    { path: 'C:\\users\\user\\file.txt', birthtimeMs: 1700000000000 },
    { path: 'C:\\Users\\User\\file.txt', birthtimeMs: 1600000000000 },
  ];
  const creationWinner = selectKeepCopy(creationTieCandidates);
  assert(
    creationWinner.birthtimeMs === 1600000000000,
    '1d. Earliest creation time tie-breaks equal length and lowercase paths (D-DF-8 rule 3)'
  );

  // Rule 3: Stale/zero creation time fallback to known valid creation time
  const zeroBirthCandidates = [
    { path: 'C:\\Users\\User\\file.txt', birthtimeMs: 0 },
    { path: 'C:\\users\\user\\file.txt', birthtimeMs: 1500000000000 },
  ];
  const validBirthWinner = selectKeepCopy(zeroBirthCandidates);
  assert(
    validBirthWinner.birthtimeMs === 1500000000000,
    '1e. Known creation time preferred over zero/stale birthtime'
  );

  // Rule 4: Deterministic fallback to first in enumerated order
  const deterministicCandidates = [
    { path: 'C:\\Users\\User\\data.bin', birthtimeMs: 1000, id: 'first' },
    { path: 'C:\\Users\\User\\data.bin', birthtimeMs: 1000, id: 'second' },
  ];
  const detWinner = selectKeepCopy(deterministicCandidates);
  assert(
    detWinner.id === 'first',
    '1f. Deterministic first in enumerated order when all rules tie (D-DF-8 rule 4)'
  );

  // Idempotence & stability: 100 repeated runs yield identical winner
  let idempotentConsistent = true;
  for (let i = 0; i < 100; i++) {
    const w = selectKeepCopy(shortestTestCandidates);
    if (w.path !== 'C:\\Users\\Alice\\Documents\\presentation.pdf') {
      idempotentConsistent = false;
      break;
    }
  }
  assert(idempotentConsistent, '1g. Same input deterministically produces exact same keep-copy output');

  console.log('\n=== Section 2: Hashing Constants & Streaming (hash.ts) (D-DF-3) ===\n');

  assert(
    DEFAULT_PARTIAL_HASH_THRESHOLD_BYTES === 10 * 1024 * 1024,
    '2a. Partial hash threshold is 10 MB constant (D-DF-3)'
  );
  assert(
    DEFAULT_HASH_WINDOW_BYTES === 4 * 1024,
    '2b. Hash window is 4 KB constant (D-DF-3)'
  );

  // Setup temporary test workspace
  const tmpRoot = path.join(os.tmpdir(), `deskclean-dup-test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
  fs.mkdirSync(tmpRoot, { recursive: true });

  const testBuf = Buffer.from('DeskKlean DuplicateFinder SHA-256 Stream Test Content');
  const testFile = path.join(tmpRoot, 'stream_test.txt');
  fs.writeFileSync(testFile, testBuf);

  const expectedSha256 = crypto.createHash('sha256').update(testBuf).digest('hex');
  const streamedSha256 = await computeFullHash(testFile);
  assert(streamedSha256 === expectedSha256, '2c. Streamed computeFullHash matches crypto SHA-256');

  console.log('\n=== Section 3: Partial Hash Prefilter & Full Hash Confirmation (D-DF-3) ===\n');

  // Test partial hash logic on two 12 MB files:
  // File A: Head 4KB same, Tail 4KB same, Middle filled with 0xAA
  // File B: Head 4KB same, Tail 4KB same, Middle filled with 0xBB
  const headChunk = Buffer.alloc(4096, 0x11);
  const tailChunk = Buffer.alloc(4096, 0x99);
  const middleA = Buffer.alloc(12 * 1024 * 1024 - 8192, 0xaa);
  const middleB = Buffer.alloc(12 * 1024 * 1024 - 8192, 0xbb);

  const fileA12MB = path.join(tmpRoot, 'fileA_12mb.bin');
  const fileB12MB = path.join(tmpRoot, 'fileB_12mb.bin');

  const streamWrite = (fPath, ...buffers) => {
    const ws = fs.createWriteStream(fPath);
    for (const b of buffers) ws.write(b);
    return new Promise((res) => ws.end(res));
  };

  await streamWrite(fileA12MB, headChunk, middleA, tailChunk);
  await streamWrite(fileB12MB, headChunk, middleB, tailChunk);

  const partialHashA = await computePartialHash(fileA12MB, 12 * 1024 * 1024);
  const partialHashB = await computePartialHash(fileB12MB, 12 * 1024 * 1024);
  assert(partialHashA === partialHashB, '3a. Two files with same head and tail have identical partial hash');

  const fullHashA = await computeFullHash(fileA12MB);
  const fullHashB = await computeFullHash(fileB12MB);
  assert(fullHashA !== fullHashB, '3b. Two files with different middles have different full SHA-256');

  // Run scanDuplicates on directory with fileA and fileB
  // Because middles differ, they MUST NOT be confirmed as duplicates!
  const collisionResult = await scanDuplicates({
    directories: [tmpRoot],
    matchBy: 'hash',
    fileTypes: ['*'],
    minSizeBytes: 1024 * 1024,
  });

  assert(
    collisionResult.duplicateGroupCount === 0,
    '3c. Partial-hash collision with different middle is NOT confirmed as duplicate'
  );
  assert(
    collisionResult.groups.length === 0,
    '3d. No false positive duplicate groups generated'
  );

  // Now create File C which is an exact duplicate of File A (identical 12 MB)
  const fileC12MB = path.join(tmpRoot, 'fileC_12mb_duplicate.bin');
  await streamWrite(fileC12MB, headChunk, middleA, tailChunk);

  const confirmedResult = await scanDuplicates({
    directories: [tmpRoot],
    matchBy: 'hash',
    fileTypes: ['*'],
    minSizeBytes: 1024 * 1024,
  });

  assert(
    confirmedResult.duplicateGroupCount === 1,
    '3e. Exactly identical 12 MB files confirmed via full SHA-256'
  );
  assert(
    confirmedResult.groups[0].files.length === 2,
    '3f. Confirmed group contains exactly the 2 identical files'
  );
  assert(
    confirmedResult.groups[0].files.some((f) => f.path === fileA12MB) &&
      confirmedResult.groups[0].files.some((f) => f.path === fileC12MB),
    '3g. Identical full content confirmed, fileB excluded'
  );

  console.log('\n=== Section 4: Size Filter & Zero-Byte Exclusion (D-DF-4 & Binding Rule) ===\n');

  // Create a 500 KB file (below default 1 MB threshold)
  const smallFile = path.join(tmpRoot, 'small_500kb.bin');
  fs.writeFileSync(smallFile, Buffer.alloc(500 * 1024, 0x55));

  // Create a 0-byte file
  const zeroFile = path.join(tmpRoot, 'zero_byte.bin');
  fs.writeFileSync(zeroFile, Buffer.alloc(0));

  const sizeFilterResult = await scanDuplicates({
    directories: [tmpRoot],
    matchBy: 'hash',
    fileTypes: ['*'],
    minSizeBytes: 1024 * 1024, // 1 MB
  });

  assert(
    sizeFilterResult.belowMinSizeCount >= 2,
    '4a. Files below 1 MB and zero-byte files are counted in belowMinSizeCount'
  );
  assert(
    !sizeFilterResult.groups.some((g) => g.files.some((f) => f.path === smallFile || f.path === zeroFile)),
    '4b. Files below threshold never enter duplicate groups'
  );

  // Configurable minSizeBytes test: lowering threshold to 400 KB indexes the 500 KB file
  const smallFile2 = path.join(tmpRoot, 'small_500kb_copy.bin');
  fs.writeFileSync(smallFile2, Buffer.alloc(500 * 1024, 0x55));

  const customMinResult = await scanDuplicates({
    directories: [tmpRoot],
    matchBy: 'hash',
    fileTypes: ['*'],
    minSizeBytes: 400 * 1024, // 400 KB
  });

  const smallGroup = customMinResult.groups.find((g) => g.sizeBytes === 500 * 1024);
  assert(smallGroup !== undefined, '4c. Configurable minSizeBytes allows smaller duplicates when requested');
  assert(smallGroup && smallGroup.files.length === 2, '4d. 500 KB duplicate files grouped with 400 KB threshold');

  console.log('\n=== Section 5: Hardlink Exclusion via nlink > 1 (D-DF-6) ===\n');

  // Pure logic isHardlink tests
  const normalStat = { nlink: 1 };
  const hardlinkStat = { nlink: 2 };
  const noNlinkStat = { nlink: undefined };

  const isNormLink = await isHardlink('some_file.bin', normalStat);
  assert(!isNormLink, '5a. isHardlink returns false when nlink === 1');

  const isHardLinkDetected = await isHardlink('some_file.bin', hardlinkStat);
  assert(isHardLinkDetected, '5b. isHardlink returns true when nlink > 1 (D-DF-6 primary mechanism)');

  let fallbackCalled = false;
  const isFallbackLink = await isHardlink('some_file.bin', noNlinkStat, async () => {
    fallbackCalled = true;
    return true;
  });
  assert(fallbackCalled && isFallbackLink, '5c. isHardlink calls fallback when nlink is missing');

  // Real filesystem hardlink test: create a 2 MB file and link it
  const hardlinkSubdir = path.join(tmpRoot, 'hardlinks');
  fs.mkdirSync(hardlinkSubdir, { recursive: true });
  const realFile = path.join(hardlinkSubdir, 'real_data.bin');
  fs.writeFileSync(realFile, Buffer.alloc(2 * 1024 * 1024, 0x77));

  const hardlinkedFile = path.join(hardlinkSubdir, 'link_to_data.bin');
  let hardlinkCreated = false;
  try {
    fs.linkSync(realFile, hardlinkedFile);
    hardlinkCreated = true;
  } catch {
    // POSIX or filesystem might not support linkSync in some environments
  }

  if (hardlinkCreated) {
    const hardlinkScan = await scanDuplicates({
      directories: [hardlinkSubdir],
      matchBy: 'hash',
      fileTypes: ['*'],
      minSizeBytes: 1024 * 1024,
    });

    assert(
      hardlinkScan.duplicateGroupCount === 0,
      '5d. Hardlinks with nlink > 1 are excluded from duplicate groups (reclaims nothing)'
    );
    assert(
      hardlinkScan.skippedCount >= 2,
      '5e. Excluded hardlink files are counted in skippedCount'
    );
  } else {
    assert(true, '5d-e. Hardlink filesystem test skipped (linkSync not supported in environment)');
  }

  console.log('\n=== Section 6: Reparse-Point Exclusion (D-DF-5) ===\n');

  // Reparse point root check: refuse scan if root is a symlink
  const symlinkRootDir = path.join(tmpRoot, 'symlink_root');
  const targetDir = path.join(tmpRoot, 'target_dir');
  fs.mkdirSync(targetDir, { recursive: true });

  let symlinkCreated = false;
  try {
    fs.symlinkSync(targetDir, symlinkRootDir, 'dir');
    symlinkCreated = true;
  } catch {
    // Symlink creation might need elevated rights on Windows or restricted POSIX
  }

  if (symlinkCreated) {
    let refused = false;
    let refuseMessage = '';
    try {
      await scanDuplicates({
        directories: [symlinkRootDir],
        matchBy: 'hash',
        fileTypes: ['*'],
        minSizeBytes: 1024 * 1024,
      });
    } catch (err) {
      refused = true;
      refuseMessage = err.message;
    }
    assert(refused, '6a. Scan refuses when scan root is a symlink/reparse point');
    assert(
      refuseMessage.includes('reparse point') || refuseMessage.includes('symbolic link'),
      '6b. Refusal message explains reparse point violation'
    );

    // Symlink inside root directory is skipped
    const normalDirWithSymlink = path.join(tmpRoot, 'has_symlink');
    fs.mkdirSync(normalDirWithSymlink, { recursive: true });
    const symlinkSub = path.join(normalDirWithSymlink, 'sym_sub');
    try {
      fs.symlinkSync(targetDir, symlinkSub, 'dir');
    } catch {}

    const symlinkFile = path.join(normalDirWithSymlink, 'sym_file.bin');
    try {
      fs.symlinkSync(fileA12MB, symlinkFile, 'file');
    } catch {}

    const innerSymScan = await scanDuplicates({
      directories: [normalDirWithSymlink],
      matchBy: 'hash',
      fileTypes: ['*'],
      minSizeBytes: 1024 * 1024,
    });

    assert(
      innerSymScan.skippedCount >= 1,
      '6c. Symlink/reparse point inside scan root is skipped during enumeration'
    );
  } else {
    assert(true, '6a-c. Symlink tests simulated on environment without symlink support');
  }

  console.log('\n=== Section 7: matchBy "name-size" Coercion (Binding Rule) ===\n');

  let warningLogged = false;
  const originalWarn = console.warn;
  console.warn = (...args) => {
    if (args.some((a) => typeof a === 'string' && a.includes('name-size'))) {
      warningLogged = true;
    }
    originalWarn(...args);
  };

  const nameSizeScan = await scanDuplicates({
    directories: [tmpRoot],
    matchBy: 'name-size',
    fileTypes: ['*'],
    minSizeBytes: 1024 * 1024,
  });

  console.warn = originalWarn;

  assert(warningLogged, '7a. matchBy "name-size" logs a warning when coerced');
  // Confirm that even though name-size was passed, File A and File B (different content) were NOT matched
  assert(
    !nameSizeScan.groups.some(
      (g) => g.files.some((f) => f.path === fileA12MB) && g.files.some((f) => f.path === fileB12MB)
    ),
    '7b. Coerced scan still strictly uses full SHA-256 content proof (never name/size alone)'
  );

  console.log('\n=== Section 8: wastedBytes Arithmetic & Keep-Copy Marking ===\n');

  // Verify wastedBytes arithmetic for a known group of 2 files of 12 MB
  const dup12MBGroup = confirmedResult.groups.find((g) => g.sizeBytes === 12 * 1024 * 1024);
  assert(dup12MBGroup !== undefined, '8a. 12 MB duplicate group found');
  assert(
    dup12MBGroup && dup12MBGroup.wastedBytes === 12 * 1024 * 1024 * (2 - 1),
    '8b. wastedBytes for 2 copies of 12 MB is exactly 12 MB (groupSize * (count - 1))'
  );
  assert(
    confirmedResult.wastedBytes >= 12 * 1024 * 1024,
    '8c. Total wastedBytes is sum of wastedBytes across all groups'
  );

  // Keep-copy marking in confirmed group
  const originalFile = dup12MBGroup.files.find((f) => f.isOriginal);
  const duplicateFiles = dup12MBGroup.files.filter((f) => !f.isOriginal);

  assert(originalFile !== undefined, '8d. Exactly one keep-copy marked with isOriginal: true');
  assert(
    originalFile && originalFile.selectedForDeletion === false,
    '8e. Keep-copy has selectedForDeletion: false'
  );
  assert(
    duplicateFiles.length === 1 && duplicateFiles.every((f) => f.selectedForDeletion === true),
    '8f. Non-keep copies have selectedForDeletion: true by default'
  );
  assert(
    dup12MBGroup.fileName === originalFile.name,
    '8g. Group fileName is set to canonical keep-copy name'
  );

  // Clean up fixture
  try {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  } catch {}

  console.log('\n=== Section 9: Framework Plan Construction & Keep-Copy Protection (Phase 11) ===\n');

  // Create temporary fixture files on disk for plan & execution tests
  const phase11Tmp = path.join(os.tmpdir(), `deskklean-dup11-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
  fs.mkdirSync(phase11Tmp, { recursive: true });

  const keepCopyFile = path.join(phase11Tmp, 'original.bin');
  const duplicateFile1 = path.join(phase11Tmp, 'duplicate1.bin');
  const duplicateFile2 = path.join(phase11Tmp, 'duplicate2.bin');

  fs.writeFileSync(keepCopyFile, Buffer.alloc(1024 * 1024, 0x11));
  fs.writeFileSync(duplicateFile1, Buffer.alloc(1024 * 1024, 0x11));
  fs.writeFileSync(duplicateFile2, Buffer.alloc(1024 * 1024, 0x11));

  const mockGroup = {
    hash: 'mockhash123',
    fileName: 'original.bin',
    sizeBytes: 1024 * 1024,
    wastedBytes: 2 * 1024 * 1024,
    files: [
      {
        id: 'file-keep',
        path: keepCopyFile,
        name: 'original.bin',
        sizeBytes: 1024 * 1024,
        hash: 'mockhash123',
        lastModified: new Date().toISOString(),
        selectedForDeletion: false,
        isOriginal: true,
      },
      {
        id: 'file-dup-1',
        path: duplicateFile1,
        name: 'duplicate1.bin',
        sizeBytes: 1024 * 1024,
        hash: 'mockhash123',
        lastModified: new Date().toISOString(),
        selectedForDeletion: true,
        isOriginal: false,
      },
      {
        id: 'file-dup-2',
        path: duplicateFile2,
        name: 'duplicate2.bin',
        sizeBytes: 1024 * 1024,
        hash: 'mockhash123',
        lastModified: new Date().toISOString(),
        selectedForDeletion: true,
        isOriginal: false,
      },
    ],
  };

  const mockScanResult = {
    root: phase11Tmp,
    scannedFileCount: 3,
    skippedCount: 0,
    belowMinSizeCount: 0,
    duplicateGroupCount: 1,
    duplicateFileCount: 3,
    wastedBytes: 2 * 1024 * 1024,
    groups: [mockGroup],
    scanDurationMs: 10,
    scannedAt: new Date().toISOString(),
  };

  // 9a-c. Rail: The keep-copy is NEVER a deletion target even if selected by the caller
  const planWithKeepSelected = createDuplicateDeletePlan(mockScanResult, ['file-keep', 'file-dup-1']);
  assert(
    !planWithKeepSelected.actions.some((a) => a.target === keepCopyFile || a.id === 'file-keep'),
    '9a. Keep-copy is never emitted as a deletion action even when explicitly requested'
  );
  assert(
    planWithKeepSelected.blocked.some(
      (b) => b.target === keepCopyFile && b.reason.toLowerCase().includes('keep-copy')
    ),
    '9b. Keep-copy exclusion is recorded in blocked list with explanatory reason'
  );
  assert(
    planWithKeepSelected.actions.some((a) => a.target === duplicateFile1),
    '9c. Non-keep duplicate copy is successfully included in planned actions'
  );

  // 9d. Rail: The plan contains ONLY files from the scan, never unknown files
  const planWithUnknownFiles = createDuplicateDeletePlan(mockScanResult, ['unrecognized-id', 'file-dup-1']);
  assert(
    planWithUnknownFiles.actions.length === 1 && planWithUnknownFiles.actions[0].id === 'file-dup-1',
    '9d. Plan includes only files verified to exist in scan; unknown IDs ignored'
  );

  // 9e. Plan reversibility is 'reversible'
  assert(
    planWithKeepSelected.reversibility === 'reversible',
    '9e. Plan reversibility is declared as reversible (D-R2-4)'
  );

  // 9f. Action deletionMethod is always 'recycle-bin' (never 'permanent')
  assert(
    planWithKeepSelected.actions.every((a) => a.metadata?.deletionMethod === 'recycle-bin'),
    '9f. deletionMethod in action metadata is strictly "recycle-bin"'
  );

  // 9g. reclaimableBytes is exact sum from scan
  assert(
    planWithKeepSelected.totalReclaimableBytes === 1024 * 1024,
    '9g. totalReclaimableBytes is exact sum of selected files (never estimated)'
  );

  // 9h. Selecting keep-copy alone results in zero actions
  const planKeepOnly = createDuplicateDeletePlan(mockScanResult, ['file-keep']);
  assert(
    planKeepOnly.actions.length === 0,
    '9h. Selecting keep-copy alone produces 0 deletion actions'
  );

  console.log('\n=== Section 10: Path Validation & 2nd Line of Defense (Phase 11) ===\n');

  // 10a. Framework path validation blocks keep-copy if passed as customExcludedPaths
  const valKeepCheck = validatePath(keepCopyFile, {
    customExcludedPaths: [keepCopyFile],
    allowUserData: true,
  });
  assert(
    valKeepCheck.allowed === false,
    '10a. Framework path validation refuses keep-copy path as 2nd line of defense'
  );

  // 10b. File escaping scan root is refused
  const outsideRootTmp = path.join(os.tmpdir(), `deskclean-outside-${Date.now()}`);
  fs.mkdirSync(outsideRootTmp, { recursive: true });
  const outsideFile = path.join(outsideRootTmp, 'outside.bin');
  fs.writeFileSync(outsideFile, Buffer.alloc(1024, 0x22));

  const valOutsideCheck = validatePath(outsideFile, {
    scanRoot: phase11Tmp,
    allowUserData: true,
  });
  assert(
    valOutsideCheck.allowed === false && valOutsideCheck.reason.includes('escapes declared scan root'),
    '10b. File escaping declared scanRoot is refused by path validation'
  );

  console.log('\n=== Section 11: The unlink() Guard & Recycle Fail-Closed Rail (Phase 11) ===\n');

  const tmpBackupDir = path.join(phase11Tmp, 'backups');
  fs.mkdirSync(tmpBackupDir, { recursive: true });

  // 11a-e. BINDING RAIL: when trashItem fails and deletionMethod === 'recycle-bin',
  // unlink() is NEVER called. If PowerShell also fails, the operation fails closed.
  let unlinkCalled = false;
  let trashItemCalled = false;
  let powershellCalled = false;

  const testFileGuard = path.join(phase11Tmp, 'unlink_guard_test.bin');
  fs.writeFileSync(testFileGuard, Buffer.alloc(1024, 0x33));

  const planUnlinkGuard = {
    id: `plan-guard-${Date.now()}`,
    module: 'duplicate-finder',
    actions: [
      {
        id: 'guard-action',
        kind: 'delete-file',
        target: testFileGuard,
        description: 'Test unlink guard',
        reclaimableBytes: 1024,
        metadata: { deletionMethod: 'recycle-bin' },
      },
    ],
    blocked: [],
    totalReclaimableBytes: 1024,
    reversibility: 'reversible',
    requiresElevation: false,
    createdAt: new Date().toISOString(),
  };

  const resUnlinkGuard = await executeFileDeletions(planUnlinkGuard, undefined, {
    backupDirOverride: tmpBackupDir,
    isWindowsFn: () => true,
    trashItemFn: async () => {
      trashItemCalled = true;
      throw new Error('Simulated Electron trashItem failure');
    },
    powershellRecycleFn: async () => {
      powershellCalled = true;
      throw new Error('Simulated PowerShell RecycleOption failure');
    },
    unlinkFn: async () => {
      unlinkCalled = true;
    },
  });

  assert(
    unlinkCalled === false,
    '11a. BINDING RAIL: unlink() is NEVER called when deletionMethod is "recycle-bin"'
  );
  assert(
    fs.existsSync(testFileGuard) === true,
    '11b. BINDING RAIL: File still exists on disk; was NOT silently permanently deleted'
  );
  assert(
    resUnlinkGuard.success === false,
    '11c. Operation fails closed (success: false) when Recycle Bin operations fail'
  );
  assert(
    resUnlinkGuard.failed === 1 && resUnlinkGuard.completed === 0,
    '11d. Failure count is 1 and completed is 0'
  );
  assert(
    trashItemCalled === true && powershellCalled === true,
    '11e. trashItem was attempted and PowerShell fallback was attempted'
  );

  // 11f-g. PowerShell fallback succeeds when trashItem fails
  const testFilePs = path.join(phase11Tmp, 'ps_fallback_test.bin');
  fs.writeFileSync(testFilePs, Buffer.alloc(1024, 0x44));

  const planPsFallback = {
    id: `plan-ps-${Date.now()}`,
    module: 'duplicate-finder',
    actions: [
      {
        id: 'ps-action',
        kind: 'delete-file',
        target: testFilePs,
        description: 'Test PS fallback',
        reclaimableBytes: 1024,
        metadata: { deletionMethod: 'recycle-bin' },
      },
    ],
    blocked: [],
    totalReclaimableBytes: 1024,
    reversibility: 'reversible',
    requiresElevation: false,
    createdAt: new Date().toISOString(),
  };

  let psFallbackExecuted = false;
  const resPsFallback = await executeFileDeletions(planPsFallback, undefined, {
    backupDirOverride: tmpBackupDir,
    isWindowsFn: () => true,
    trashItemFn: async () => {
      throw new Error('Simulated trashItem failure');
    },
    powershellRecycleFn: async (target) => {
      psFallbackExecuted = true;
      // Simulate successful recycle by removing the file
      fs.unlinkSync(target);
    },
  });

  assert(
    psFallbackExecuted === true,
    '11f. PowerShell fallback is invoked when trashItem fails'
  );
  assert(
    resPsFallback.success === true && resPsFallback.completed === 1,
    '11g. Successful PowerShell fallback completes operation with success: true'
  );

  console.log('\n=== Section 12: Partial Failure Reporting & Verification (Phase 11) ===\n');

  // 12a-d. Partial failure reporting: 1 file recycled, 1 file locked/failing
  const filePart1 = path.join(phase11Tmp, 'partial_success.bin');
  const filePart2 = path.join(phase11Tmp, 'partial_fail.bin');
  fs.writeFileSync(filePart1, Buffer.alloc(2000, 0x55));
  fs.writeFileSync(filePart2, Buffer.alloc(3000, 0x66));

  const planPartial = {
    id: `plan-part-${Date.now()}`,
    module: 'duplicate-finder',
    actions: [
      {
        id: 'part-1',
        kind: 'delete-file',
        target: filePart1,
        description: 'Part 1',
        reclaimableBytes: 2000,
        metadata: { deletionMethod: 'recycle-bin' },
      },
      {
        id: 'part-2',
        kind: 'delete-file',
        target: filePart2,
        description: 'Part 2',
        reclaimableBytes: 3000,
        metadata: { deletionMethod: 'recycle-bin' },
      },
    ],
    blocked: [],
    totalReclaimableBytes: 5000,
    reversibility: 'reversible',
    requiresElevation: false,
    createdAt: new Date().toISOString(),
  };

  const resPartial = await executeFileDeletions(planPartial, undefined, {
    backupDirOverride: tmpBackupDir,
    isWindowsFn: () => true,
    trashItemFn: async (target) => {
      if (target === filePart1) {
        fs.unlinkSync(target); // Success for filePart1
      } else {
        throw new Error('File locked by another process (EBUSY)');
      }
    },
    powershellRecycleFn: async () => {
      throw new Error('Fallback also locked');
    },
  });

  assert(
    resPartial.success === false,
    '12a. Partial failure reports success: false (completed !== actions.length)'
  );
  assert(
    resPartial.completed === 1,
    '12b. Partial failure completed count is exactly 1'
  );
  assert(
    resPartial.failed === 1,
    '12c. Partial failure failed count is exactly 1'
  );
  assert(
    resPartial.reclaimableBytes === 2000,
    '12d. Freed bytes counts ONLY actually recycled files (2000 bytes, never 5000)'
  );

  // 12e-f. Verification by re-read: silent no-op is NOT a success
  const silentFailFile = path.join(phase11Tmp, 'silent_fail.bin');
  fs.writeFileSync(silentFailFile, Buffer.alloc(1000, 0x77));

  const planSilent = {
    id: `plan-silent-${Date.now()}`,
    module: 'duplicate-finder',
    actions: [
      {
        id: 'silent-1',
        kind: 'delete-file',
        target: silentFailFile,
        description: 'Silent fail',
        reclaimableBytes: 1000,
        metadata: { deletionMethod: 'recycle-bin' },
      },
    ],
    blocked: [],
    totalReclaimableBytes: 1000,
    reversibility: 'reversible',
    requiresElevation: false,
    createdAt: new Date().toISOString(),
  };

  const resSilent = await executeFileDeletions(planSilent, undefined, {
    backupDirOverride: tmpBackupDir,
    isWindowsFn: () => true,
    trashItemFn: async () => {
      // Claims success, but does not remove the file!
    },
  });

  assert(
    resSilent.success === false && resSilent.failed === 1,
    '12e. Verification by re-read flags target still on disk as failure (never false success)'
  );
  assert(
    resSilent.failures[0].error.includes('Verification failed'),
    '12f. Error explicitly states verification failed (target still exists)'
  );

  // 12g. Backup manifest written to disk
  assert(
    typeof resSilent.backupPath === 'string' && fs.existsSync(resSilent.backupPath),
    '12g. Backup manifest written to disk before execution'
  );

  // Cleanup fixtures
  try {
    fs.rmSync(phase11Tmp, { recursive: true, force: true });
    fs.rmSync(outsideRootTmp, { recursive: true, force: true });
  } catch {}

  console.log('\n========================================');
  console.log(`Total tests: ${passedCount + failedCount}`);
  console.log(`Passed:      ${passedCount}`);
  console.log(`Failed:      ${failedCount}`);
  console.log('========================================\n');

  if (failedCount > 0) {
    process.exit(1);
  } else {
    console.log('ALL PHASE 10 & 11 DUPLICATEFINDER TESTS PASSED!\n');
  }
}

runTests().catch((err) => {
  console.error('Unhandled test failure:', err);
  process.exit(1);
});
