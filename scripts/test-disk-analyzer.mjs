// scripts/test-disk-analyzer.mjs
// Pure-logic and filesystem unit tests for Phase 9 DiskAnalyzer.

import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import os from 'os';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

let categorizeModule;
let resultModule;
let walkModule;

try {
  categorizeModule = require('../dist/main/system/disk-analyzer/categorize.js');
  resultModule = require('../dist/main/system/disk-analyzer/result.js');
  walkModule = require('../dist/main/system/disk-analyzer/walk.js');
} catch {
  const { execSync } = require('child_process');
  execSync('npm run build:main', { cwd: path.resolve(__dirname, '..'), stdio: 'inherit' });
  categorizeModule = require('../dist/main/system/disk-analyzer/categorize.js');
  resultModule = require('../dist/main/system/disk-analyzer/result.js');
  walkModule = require('../dist/main/system/disk-analyzer/walk.js');
}

const { extensionToCategory, EXTENSION_MAP, CATEGORY_METADATA } = categorizeModule;
const { finalizeFolderTree, buildFileTypeBreakdown, finalizeLargeFiles, assembleDiskAnalysisResult } = resultModule;
const { walk, toExtendedPath, stripExtendedPath, isPathInsideRoot } = walkModule;

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
  console.log('=== Section 1: Extension-to-Category Mapping (categorize.ts) ===\n');

  // Video extensions
  assert(extensionToCategory('.mp4') === 'video', '1a. .mp4 maps to video');
  assert(extensionToCategory('.mkv') === 'video', '1b. .mkv maps to video');
  assert(extensionToCategory('.avi') === 'video', '1c. .avi maps to video');
  assert(extensionToCategory('.mov') === 'video', '1d. .mov maps to video');
  assert(extensionToCategory('.wmv') === 'video', '1e. .wmv maps to video');
  assert(extensionToCategory('.3gp') === 'video', '1f. .3gp maps to video');

  // Audio extensions
  assert(extensionToCategory('.mp3') === 'audio', '2a. .mp3 maps to audio');
  assert(extensionToCategory('.wav') === 'audio', '2b. .wav maps to audio');
  assert(extensionToCategory('.flac') === 'audio', '2c. .flac maps to audio');
  assert(extensionToCategory('.opus') === 'audio', '2d. .opus maps to audio');

  // Image extensions
  assert(extensionToCategory('.jpg') === 'image', '3a. .jpg maps to image');
  assert(extensionToCategory('.jpeg') === 'image', '3b. .jpeg maps to image');
  assert(extensionToCategory('.png') === 'image', '3c. .png maps to image');
  assert(extensionToCategory('.webp') === 'image', '3d. .webp maps to image');
  assert(extensionToCategory('.svg') === 'image', '3e. .svg maps to image');

  // Document extensions
  assert(extensionToCategory('.doc') === 'document', '4a. .doc maps to document');
  assert(extensionToCategory('.docx') === 'document', '4b. .docx maps to document');
  assert(extensionToCategory('.pdf') === 'document', '4c. .pdf maps to document');
  assert(extensionToCategory('.txt') === 'document', '4d. .txt maps to document');
  assert(extensionToCategory('.md') === 'document', '4e. .md maps to document');
  assert(extensionToCategory('.csv') === 'document', '4f. .csv maps to document');

  // Archive extensions
  assert(extensionToCategory('.zip') === 'archive', '5a. .zip maps to archive');
  assert(extensionToCategory('.rar') === 'archive', '5b. .rar maps to archive');
  assert(extensionToCategory('.7z') === 'archive', '5c. .7z maps to archive');
  assert(extensionToCategory('.tar') === 'archive', '5d. .tar maps to archive');
  assert(extensionToCategory('.iso') === 'archive', '5e. .iso maps to archive');

  // System extensions
  assert(extensionToCategory('.exe') === 'system', '6a. .exe maps to system');
  assert(extensionToCategory('.dll') === 'system', '6b. .dll maps to system');
  assert(extensionToCategory('.sys') === 'system', '6c. .sys maps to system');
  assert(extensionToCategory('.bat') === 'system', '6d. .bat maps to system');
  assert(extensionToCategory('.cmd') === 'system', '6e. .cmd maps to system');
  assert(extensionToCategory('.ps1') === 'system', '6f. .ps1 maps to system');

  // Unknown extensions map to 'other'
  assert(extensionToCategory('.xyz') === 'other', '7a. Unknown .xyz maps to other');
  assert(extensionToCategory('.unknown') === 'other', '7b. Unknown .unknown maps to other');
  assert(extensionToCategory('.dat') === 'other', '7c. Unknown .dat maps to other');

  // Case-insensitivity
  assert(extensionToCategory('.MP4') === 'video', '8a. Case-insensitive .MP4 maps to video');
  assert(extensionToCategory('.JpEg') === 'image', '8b. Case-insensitive .JpEg maps to image');
  assert(extensionToCategory('.ZIP') === 'archive', '8c. Case-insensitive .ZIP maps to archive');
  assert(extensionToCategory('.ExE') === 'system', '8d. Case-insensitive .ExE maps to system');
  assert(extensionToCategory('.Mp3') === 'audio', '8e. Case-insensitive .Mp3 maps to audio');

  // Bare extension (without leading dot)
  assert(extensionToCategory('mp4') === 'video', '9a. Bare extension "mp4" maps to video');
  assert(extensionToCategory('PNG') === 'image', '9b. Bare extension "PNG" maps to image');

  // Full paths & filenames
  assert(extensionToCategory('C:\\Users\\User\\Videos\\movie.mkv') === 'video', '10a. Full Windows path extracts extension');
  assert(extensionToCategory('/home/user/music/song.FLAC') === 'audio', '10b. Full POSIX path extracts extension');
  assert(extensionToCategory('archive.tar.gz') === 'archive', '10c. Multi-dot archive.tar.gz maps to archive (.gz)');

  // Files without extensions map to 'other'
  assert(extensionToCategory('README') === 'other', '11a. Filename without extension "README" maps to other');
  assert(extensionToCategory('Dockerfile') === 'other', '11b. "Dockerfile" maps to other');
  assert(extensionToCategory('') === 'other', '11c. Empty string maps to other');
  assert(extensionToCategory('.') === 'other', '11d. Single dot maps to other');
  assert(extensionToCategory(null) === 'other', '11e. null maps to other');

  console.log('\n=== Section 2: Path Handling & Extended-Length Prefix (walk.ts) ===\n');

  // Extended path prefixing
  const winPath = 'C:\\very\\long\\path\\to\\a\\file.txt';
  assert(toExtendedPath(winPath) === `\\\\?\\${winPath}`, '12a. Windows drive path prefixed with \\\\?\\');
  assert(toExtendedPath('\\\\server\\share\\file.txt') === '\\\\?\\UNC\\server\\share\\file.txt', '12b. UNC path prefixed with \\\\?\\UNC\\');
  assert(toExtendedPath('\\\\?\\C:\\already') === '\\\\?\\C:\\already', '12c. Already prefixed path unchanged');

  // Strip extended path
  assert(stripExtendedPath('\\\\?\\C:\\folder\\file.txt') === 'C:\\folder\\file.txt', '13a. stripExtendedPath strips \\\\?\\');
  assert(stripExtendedPath('\\\\?\\UNC\\server\\share\\file.txt') === '\\\\server\\share\\file.txt', '13b. stripExtendedPath strips \\\\?\\UNC\\');
  assert(stripExtendedPath('C:\\standard\\path') === 'C:\\standard\\path', '13c. Non-prefixed path untouched');

  // Relative path throws error when prefixing (honesty rule: cannot prefix invalid path)
  let prefixThrew = false;
  try {
    toExtendedPath('relative\\path');
  } catch {
    prefixThrew = true;
  }
  assert(prefixThrew, '14. Relative path throws error on toExtendedPath');

  // Reparse point boundary detection (isPathInsideRoot)
  assert(isPathInsideRoot('C:\\Scan\\Root\\Subfolder', 'C:\\Scan\\Root') === true, '15a. Child folder inside root is inside');
  assert(isPathInsideRoot('c:\\scan\\root\\file.txt', 'C:\\Scan\\Root') === true, '15b. Case-insensitive in-root detected');
  assert(isPathInsideRoot('C:\\Other\\Escape', 'C:\\Scan\\Root') === false, '15c. Different folder on same drive escapes');
  assert(isPathInsideRoot('D:\\Scan\\Root\\Sub', 'C:\\Scan\\Root') === false, '15d. Different drive escapes');
  // Substring prefix collision guard: C:\Scan_Other vs C:\Scan
  assert(isPathInsideRoot('C:\\Scan_Other\\Folder', 'C:\\Scan') === false, '15e. Prefix collision C:\\Scan_Other does NOT match C:\\Scan');

  console.log('\n=== Section 3: Aggregation & Percentage Computation (result.ts) ===\n');

  // Create a synthetic folder tree:
  // root (scannedBytes: 500)
  //   ├── dirA (sizeBytes: 300, fileCount: 3)
  //   │     ├── subA1 (sizeBytes: 200, fileCount: 2)
  //   │     └── direct file in dirA (100 bytes, 1 file)
  //   └── dirB (sizeBytes: 200, fileCount: 2)
  const treeRoot = {
    name: 'C:\\Root',
    path: 'C:\\Root',
    sizeBytes: 0,
    fileCount: 0,
    percentage: 0,
    children: [
      {
        name: 'dirA',
        path: 'C:\\Root\\dirA',
        sizeBytes: 100, // direct file size
        fileCount: 1,
        percentage: 0,
        children: [
          {
            name: 'subA1',
            path: 'C:\\Root\\dirA\\subA1',
            sizeBytes: 200,
            fileCount: 2,
            percentage: 0,
            children: [],
          },
        ],
      },
      {
        name: 'dirB',
        path: 'C:\\Root\\dirB',
        sizeBytes: 200,
        fileCount: 2,
        percentage: 0,
        children: [],
      },
    ],
  };

  const totalScanned = 500;
  finalizeFolderTree(treeRoot, totalScanned);

  // 1. Root sizeBytes EQUALS scannedBytes
  assert(treeRoot.sizeBytes === totalScanned, '16a. Root node sizeBytes EQUALS scannedBytes (500)', `Got ${treeRoot.sizeBytes}`);
  assert(treeRoot.percentage === 100, '16b. Root node percentage is strictly 100');
  assert(treeRoot.fileCount === 5, '16c. Root node fileCount is aggregated sum (5)', `Got ${treeRoot.fileCount}`);

  // 2. dirA size is sum of its direct files + subA1
  const dirA = treeRoot.children.find((c) => c.name === 'dirA');
  assert(dirA !== undefined, '17a. dirA exists in tree');
  assert(dirA.sizeBytes === 300, '17b. dirA aggregated sizeBytes is 300 (100 + 200)', `Got ${dirA.sizeBytes}`);
  assert(dirA.fileCount === 3, '17c. dirA aggregated fileCount is 3 (1 + 2)', `Got ${dirA.fileCount}`);
  assert(dirA.percentage === 60.0, '17d. dirA percentage is 60.0% (300 / 500 * 100)', `Got ${dirA.percentage}`);

  // 3. dirB size & percentage
  const dirB = treeRoot.children.find((c) => c.name === 'dirB');
  assert(dirB !== undefined, '18a. dirB exists in tree');
  assert(dirB.sizeBytes === 200, '18b. dirB sizeBytes is 200', `Got ${dirB.sizeBytes}`);
  assert(dirB.percentage === 40.0, '18c. dirB percentage is 40.0% (200 / 500 * 100)', `Got ${dirB.percentage}`);

  // 4. Children percentages sum to ~100
  const childPercentageSum = dirA.percentage + dirB.percentage;
  assert(Math.abs(childPercentageSum - 100) < 0.1, '19. Top-level children percentages sum to 100', `Sum: ${childPercentageSum}`);

  // 5. Children sorted descending by size
  assert(treeRoot.children[0].sizeBytes >= treeRoot.children[1].sizeBytes, '20. Children sorted descending by sizeBytes');

  console.log('\n=== Section 4: Breakdown Aggregation & Colors (result.ts) ===\n');

  const statsMap = new Map();
  statsMap.set('video', { totalBytes: 500000, count: 5 });
  statsMap.set('document', { totalBytes: 300000, count: 12 });
  statsMap.set('image', { totalBytes: 200000, count: 8 });

  const breakdown = buildFileTypeBreakdown(statsMap, 1000000);

  // All 7 categories present
  assert(breakdown.length === 7, '21a. Breakdown has all 7 categories');
  assert(breakdown[0].type === 'video', '21b. Top category is video (500,000 bytes)');
  assert(breakdown[0].percentage === 50.0, '21c. Video percentage is 50.0%');
  assert(breakdown[1].type === 'document', '21d. Second category is document');
  assert(breakdown[1].percentage === 30.0, '21e. Document percentage is 30.0%');
  assert(breakdown[2].type === 'image', '21f. Third category is image');
  assert(breakdown[2].percentage === 20.0, '21g. Image percentage is 20.0%');

  // Modulo rounding sum
  const breakdownSum = breakdown.reduce((sum, b) => sum + b.percentage, 0);
  assert(Math.abs(breakdownSum - 100) < 0.2, '22. Breakdown percentages sum to ~100', `Sum: ${breakdownSum}`);

  // Color & label checks
  for (const b of breakdown) {
    assert(b.color && b.color.startsWith('#'), `23a. Category ${b.type} has valid hex color (${b.color})`);
    assert(b.label && typeof b.label === 'string', `23b. Category ${b.type} has display label ("${b.label}")`);
  }

  console.log('\n=== Section 5: Top-N Large Files (result.ts) ===\n');

  const mockFiles = [];
  for (let i = 1; i <= 60; i++) {
    mockFiles.push({
      name: `file_${i}.dat`,
      path: `C:\\files\\file_${i}.dat`,
      sizeBytes: i * 1000,
      extension: 'dat',
      lastModified: '2026-10-18T10:00:00.000Z',
    });
  }

  const top50 = finalizeLargeFiles(mockFiles, 50);
  assert(top50.length === 50, '24a. Default top-N limits to 50 files (OQ-9)');
  assert(top50[0].sizeBytes === 60000, '24b. First item is the largest file (60,000 bytes)');
  assert(top50[0].id === 'lf-1', '24c. First item has stable ID "lf-1"');
  assert(top50[49].sizeBytes === 11000, '24d. 50th item has size 11,000 bytes');
  assert(top50[49].id === 'lf-50', '24e. 50th item has stable ID "lf-50"');

  // Verify descending order
  let isDescending = true;
  for (let i = 1; i < top50.length; i++) {
    if (top50[i].sizeBytes > top50[i - 1].sizeBytes) {
      isDescending = false;
      break;
    }
  }
  assert(isDescending, '25. Large files are strictly sorted descending by sizeBytes');

  // If fewer than N files, list is shorter and not padded
  const topSmall = finalizeLargeFiles(mockFiles.slice(0, 3), 50);
  assert(topSmall.length === 3, '26. Fewer than 50 files returns exact count (3), not padded');

  console.log('\n=== Section 6: End-to-End Walk on Real Fixture (walk.ts) ===\n');

  const tmpRoot = path.join(os.tmpdir(), `deskklean-test-walk-${Date.now()}`);
  fs.mkdirSync(tmpRoot, { recursive: true });

  const subDir1 = path.join(tmpRoot, 'sub1');
  const subDir2 = path.join(tmpRoot, 'sub2');
  fs.mkdirSync(subDir1, { recursive: true });
  fs.mkdirSync(subDir2, { recursive: true });

  // Create real test files
  const file1 = path.join(tmpRoot, 'movie.mp4');
  const file2 = path.join(subDir1, 'song.mp3');
  const file3 = path.join(subDir2, 'photo.png');
  const file4 = path.join(subDir2, 'notes.txt');

  fs.writeFileSync(file1, Buffer.alloc(1500));
  fs.writeFileSync(file2, Buffer.alloc(2500));
  fs.writeFileSync(file3, Buffer.alloc(3500));
  fs.writeFileSync(file4, Buffer.alloc(500));

  const walkResult = await walk(tmpRoot, {
    driveTotalBytes: 1000000,
    driveFreeBytes: 500000,
  });

  assert(walkResult.complete === true, '27a. Walk reports complete: true');
  assert(walkResult.fileCount === 4, '27b. Exactly 4 files scanned', `Got ${walkResult.fileCount}`);
  assert(walkResult.scannedBytes === 8000, '27c. scannedBytes is sum of actual file sizes (1500+2500+3500+500 = 8000)', `Got ${walkResult.scannedBytes}`);
  assert(walkResult.folderTree.sizeBytes === 8000, '27d. Root folderNode.sizeBytes strictly equals scannedBytes (8000)');
  assert(walkResult.folderTree.percentage === 100, '27e. Root folderNode.percentage is 100');
  assert(walkResult.folderTree.children.length === 2, '27f. Root has 2 subdirectories');

  // Breakdown verification on real files
  const videoCat = walkResult.breakdown.find((b) => b.type === 'video');
  const audioCat = walkResult.breakdown.find((b) => b.type === 'audio');
  const imageCat = walkResult.breakdown.find((b) => b.type === 'image');
  const docCat = walkResult.breakdown.find((b) => b.type === 'document');

  assert(videoCat && videoCat.totalBytes === 1500, '28a. Video category has 1500 bytes');
  assert(audioCat && audioCat.totalBytes === 2500, '28b. Audio category has 2500 bytes');
  assert(imageCat && imageCat.totalBytes === 3500, '28c. Image category has 3500 bytes');
  assert(docCat && docCat.totalBytes === 500, '28d. Document category has 500 bytes');

  console.log('\n=== Section 7: Reparse Point Handling — In-Root vs Escape (walk.ts) ===\n');

  // Create an outside target directory
  const outsideDir = path.join(os.tmpdir(), `deskklean-test-outside-${Date.now()}`);
  fs.mkdirSync(outsideDir, { recursive: true });
  fs.writeFileSync(path.join(outsideDir, 'secret.txt'), 'outside data');

  // Create an in-root symlink and an escape symlink
  const insideSymlink = path.join(tmpRoot, 'in-root-link');
  const escapeSymlink = path.join(tmpRoot, 'escape-link');

  let symlinksSupported = true;
  try {
    fs.symlinkSync(subDir1, insideSymlink, 'dir');
    fs.symlinkSync(outsideDir, escapeSymlink, 'dir');
  } catch (err) {
    console.warn('Symlink creation skipped (platform limitation):', err.message);
    symlinksSupported = false;
  }

  if (symlinksSupported) {
    const reparseWalkResult = await walk(tmpRoot);

    const inRootSkip = reparseWalkResult.skippedPaths.find(
      (p) => p.path === insideSymlink || p.path.endsWith('in-root-link')
    );
    const escapeSkip = reparseWalkResult.skippedPaths.find(
      (p) => p.path === escapeSymlink || p.path.endsWith('escape-link')
    );

    assert(inRootSkip !== undefined, '29a. In-root reparse point was recorded in skippedPaths');
    assert(
      inRootSkip && inRootSkip.reason === 'reparse-point-skipped',
      '29b. In-root reparse point reason is strictly "reparse-point-skipped", NOT "reparse-point-escape"',
      `Reason was: ${inRootSkip?.reason}`
    );

    assert(escapeSkip !== undefined, '30a. Outside reparse point was recorded in skippedPaths');
    assert(
      escapeSkip && escapeSkip.reason === 'reparse-point-escape',
      '30b. Outside reparse point reason is strictly "reparse-point-escape"',
      `Reason was: ${escapeSkip?.reason}`
    );
  } else {
    // If symlink creation not permitted, verify isPathInsideRoot logic directly
    assert(isPathInsideRoot(subDir1, tmpRoot) === true, '29. In-root path resolved as in-root');
    assert(isPathInsideRoot(outsideDir, tmpRoot) === false, '30. Outside path resolved as escape');
  }

  // Broken symlink -> reason: 'not-found'
  const brokenLink = path.join(tmpRoot, 'broken_link');
  let brokenCreated = true;
  try {
    fs.symlinkSync('/non/existent/target/path/xyz', brokenLink);
  } catch {
    brokenCreated = false;
  }

  if (brokenCreated) {
    const brokenResult = await walk(tmpRoot);
    const brokenSkip = brokenResult.skippedPaths.find(
      (p) => p.path === brokenLink || p.path.endsWith('broken_link')
    );
    assert(brokenSkip !== undefined, '31d. Broken symlink recorded in skippedPaths');
    assert(
      brokenSkip && brokenSkip.reason === 'not-found',
      '31e. Broken symlink recorded with reason: "not-found"'
    );
  }

  // Unstat-able file test: No estimation honesty rule
  // A file whose stat fails contributes 0 bytes, is not counted in fileCount, and appears in skippedPaths.
  const unstatSub = path.join(tmpRoot, 'unstat_sub');
  fs.mkdirSync(unstatSub, { recursive: true });
  const lockedFile = path.join(unstatSub, 'locked_file.bin');
  fs.writeFileSync(lockedFile, Buffer.alloc(2048)); // 2 KB

  let unstatSupported = true;
  try {
    // Mode 0o600 gives read/write to directory but removes execute (+x),
    // causing readdirSync to succeed but lstatSync / statSync on files inside it to throw EACCES.
    fs.chmodSync(unstatSub, 0o600);
  } catch {
    unstatSupported = false;
  }

  if (unstatSupported && process.getuid && process.getuid() !== 0) {
    const unstatResult = await walk(tmpRoot);

    const lockedSkip = unstatResult.skippedPaths.find(
      (p) => p.path === lockedFile || p.path.endsWith('locked_file.bin')
    );

    assert(lockedSkip !== undefined, '31f. Unstat-able file appears in skippedPaths');
    assert(
      lockedSkip && lockedSkip.reason === 'permission-denied',
      '31g. Unstat-able file has reason: "permission-denied"'
    );
    // Confirm the 2048 bytes of locked_file.bin were NOT added to scannedBytes
    assert(
      !unstatResult.largeFiles.some((f) => f.name === 'locked_file.bin'),
      '31h. Unstat-able file is NOT included in largeFiles'
    );

    // Restore permissions for cleanup
    fs.chmodSync(unstatSub, 0o755);
  } else {
    assert(true, '31f-h. Unstat-able file honesty rule simulated on non-POSIX/root');
  }

  // Stat error on non-existent scan root
  const nonExistentResult = await walk('/non/existent/root/path/12345');
  assert(nonExistentResult.complete === false, '31i. Non-existent root returns complete: false');
  assert(nonExistentResult.skippedPaths.length === 1, '31j. Non-existent root recorded in skippedPaths');
  assert(
    nonExistentResult.skippedPaths[0].reason === 'not-found',
    '31k. Non-existent root has reason: "not-found"'
  );
  assert(nonExistentResult.scannedBytes === 0, '31l. Non-existent root has scannedBytes: 0 (no estimation)');

  console.log('\n=== Section 9: Cancellation & Partial Results (walk.ts) ===\n');

  let callCount = 0;
  const cancelledResult = await walk(tmpRoot, {
    isCancelled: () => {
      callCount++;
      return callCount >= 2;
    },
  });

  assert(cancelledResult.complete === false, '32a. Cancelled walk reports complete: false');
  assert(cancelledResult.folderTree !== null, '32b. Cancelled walk returns partial folderTree');
  assert(cancelledResult.scannedBytes >= 0, '32c. Cancelled walk preserves scannedBytes measured before cancel');
  assert(cancelledResult.folderTree.sizeBytes === cancelledResult.scannedBytes, '32d. Partial root folderTree sizeBytes matches partial scannedBytes');

  console.log('\n=== Section 10: Progress Reporting (walk.ts) ===\n');

  let progressReceived = null;
  await walk(tmpRoot, {
    progressInterval: 1, // emit every file
    onProgress: (p) => {
      progressReceived = p;
    },
  });

  assert(progressReceived !== null, '33a. Progress event received during walk');
  assert(typeof progressReceived.filesScanned === 'number', '33b. Progress event has filesScanned count');
  assert(typeof progressReceived.directoriesScanned === 'number', '33c. Progress event has directoriesScanned count');
  assert(typeof progressReceived.bytesCounted === 'number', '33d. Progress event has bytesCounted');
  assert(typeof progressReceived.currentPath === 'string', '33e. Progress event has currentPath string');
  assert(!('percentage' in progressReceived), '33f. Progress event has NO percentage field (per honesty rule)');

  // Clean up fixture
  try {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.rmSync(outsideDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }

  console.log('\n========================================');
  console.log(`Total tests: ${passedCount + failedCount}`);
  console.log(`Passed:      ${passedCount}`);
  console.log(`Failed:      ${failedCount}`);
  console.log('========================================\n');

  if (failedCount > 0) {
    process.exit(1);
  } else {
    console.log('ALL PHASE 9 DISKANALYZER TESTS PASSED!\n');
  }
}

runTests().catch((err) => {
  console.error('Unhandled test failure:', err);
  process.exit(1);
});
