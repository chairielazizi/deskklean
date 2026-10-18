# Phase 9 — DiskAnalyzer

**Status:** 🔜 specified, not built
**Depends on:** Phase 0 (system bridge) ✅ · Phase 1 (System Info, CIM drive queries) ✅

---

## Goal

Replace the hardcoded `breakdown`, `folderTree`, and `largeFiles` data in
`DISK_ANALYZE` with a real directory walk. The module is **read-only**: it reports
what is on disk and never deletes anything. The Phase 3 framework is not involved
because there is nothing destructive to plan, confirm, or back up.

---

## Why this phase is different

DiskAnalyzer is the first module that walks the filesystem at scale. Every module
so far queried CIM or the registry — structured, finite data sources. A directory
walk is unbounded: it can hit permission-denied directories, reparse points, long
paths, and files that change while being scanned. These edge cases are not
exceptions; on a real Windows machine they are routine.

The honesty rule that governs this phase:

> **No size is ever estimated.** Every byte count comes from `fs.statSync` or
> `fs.lstatSync`. If a file cannot be stat'd, it is not counted, and the path is
> recorded in `skippedPaths`. The total is the sum of what was actually measured,
> not an estimate of what is on disk.

---

## What it returns

```ts
export interface DiskAnalysisResult {
  rootPath: string;              // the directory that was scanned
  driveTotalBytes: number;       // from CIM Win32_LogicalDisk
  driveFreeBytes: number;        // from CIM Win32_LogicalDisk
  scannedBytes: number;          // sum of all file sizes from the walk
  fileCount: number;             // count of files successfully stat'd
  directoryCount: number;        // count of directories successfully read
  folderTree: DiskFolderNode;    // sizes aggregated by directory
  largeFiles: LargeFileInfo[];   // top N largest files (default 50)
  breakdown: FileTypeBreakdown[]; // by file extension category
  skippedPaths: SkippedPath[];   // paths that could not be scanned, with reasons
  scanDurationMs: number;
  complete: boolean;             // false if the scan was interrupted
}

export interface SkippedPath {
  path: string;
  reason:
    | 'permission-denied'
    | 'reparse-point-escape'   // resolved OUTSIDE the scan root
    | 'reparse-point-skipped'  // resolved INSIDE the root, skipped to avoid double-counting
    | 'not-found'
    | 'stat-error';
}
```

### Sizes aggregated by directory

`folderTree` is a recursive structure where each node's `sizeBytes` is the sum of
all file sizes in that subtree, and `fileCount` is the count of all files in that
subtree. The root node's `sizeBytes` equals `scannedBytes`.

```ts
export interface DiskFolderNode {
  name: string;
  path: string;
  sizeBytes: number;        // sum of all file sizes in this subtree
  fileCount: number;         // count of files in this subtree
  percentage: number;        // sizeBytes / scannedBytes * 100
  children?: DiskFolderNode[];
}
```

Rails:

- **A directory's size is the sum of its children's sizes.** No directory has an
  independent "size" — it is always the aggregate of the files it contains,
  directly or transitively.
- **The root's `sizeBytes` is `scannedBytes`.** These are the same number, computed
  the same way: sum of all individual `fs.statSync` size readings.
- **The root's `percentage` is 100.** Children's percentages are relative to the
  root, so they sum to approximately 100 (modulo rounding).
- **No size is ever estimated.** If a file cannot be stat'd, it contributes 0 to
  the total and its path appears in `skippedPaths`. The total is the sum of what
  was measured, not an estimate of what is on disk.

### Drive-level vs. scan-level totals

`driveTotalBytes` and `driveFreeBytes` come from CIM (`Win32_LogicalDisk`), which
Phase 1 already implements. These represent the drive's capacity, not what the
scan found.

`scannedBytes` is the sum of all file sizes from the directory walk. It will
almost always be less than `driveTotalBytes - driveFreeBytes` because:

- Some files are inaccessible (permission-denied).
- Some files are in reparse-point directories that were skipped.
- System files may be locked or hidden.
- The drive may have files that the scan root does not cover.

The result reports both numbers honestly. The UI should show "scanned X of Y used"
rather than implying the scan accounted for every byte on the drive.

Rails:

- **Never present `scannedBytes` as the drive's used space.** It is the sum of
  what was measured, which is a subset of the drive's contents.
- **The difference between drive used and scanned is reported as "unscanned" or
  "inaccessible",** not silently absorbed into an "other" category.

### Large files

`largeFiles` is the top N files by size (default 50, configurable). Each entry:

```ts
export interface LargeFileInfo {
  id: string;
  name: string;
  path: string;
  sizeBytes: number;
  extension: string;
  lastModified: string;      // ISO 8601 from stat.mtime
}
```

Rails:

- **The list is sorted by `sizeBytes` descending.** No reordering or grouping.
- **Every entry's `sizeBytes` comes from `fs.statSync`.** No estimation.
- **If fewer than N files were scanned, the list is shorter.** Not padded with
  estimates.

### File type breakdown

`breakdown` categorizes files by extension:

```ts
export type DiskFileType = 'video' | 'audio' | 'image' | 'document' | 'archive' | 'system' | 'other';

export interface FileTypeBreakdown {
  type: DiskFileType;
  label: string;
  totalBytes: number;        // sum of all file sizes in this category
  percentage: number;        // totalBytes / scannedBytes * 100
  color: string;
  count: number;             // number of files in this category
}
```

Extension-to-category mapping (common Windows file extensions — the owner may
customize this list):

| Category | Extensions |
|---|---|
| video | `.mp4` `.avi` `.mkv` `.mov` `.wmv` `.flv` `.webm` `.m4v` `.mpg` `.mpeg` `.3gp` |
| audio | `.mp3` `.wav` `.flac` `.aac` `.ogg` `.wma` `.m4a` `.opus` |
| image | `.jpg` `.jpeg` `.png` `.gif` `.bmp` `.tiff` `.tif` `.webp` `.svg` `.ico` `.heic` |
| document | `.doc` `.docx` `.pdf` `.txt` `.rtf` `.odt` `.xls` `.xlsx` `.ppt` `.pptx` `.csv` `.md` `.log` |
| archive | `.zip` `.rar` `.7z` `.tar` `.gz` `.bz2` `.xz` `.iso` `.cab` |
| system | `.exe` `.dll` `.sys` `.drv` `.ocx` `.bat` `.cmd` `.msi` `.ps1` `.vbs` `.jar` |
| other | everything else |

Rails:

- **Every size in every category is the sum of actual `fs.statSync` readings.**
  No category's size is estimated or sampled.
- **A file with no extension goes to `other`.** No guessing based on content.
- **The extension is read from the file name, not from the file's content or
  metadata.** `fs.statSync` does not return an extension; it is parsed from the
  name.
- **Case-insensitive:** `.JPG` and `.jpg` are the same category.

---

## Directory walk

### Approach

Use Node.js `fs` module directly, not PowerShell. The walk is read-only and needs
to be fast; PowerShell would be slow for recursive directory enumeration. The
project already uses `fs` for file operations (SecureErase, backup store).

### Algorithm

```
walk(rootPath):
  initialize result with rootPath, zeroed counters
  queue = [{ path: rootPath, node: rootFolderNode }]

  while queue is not empty:
    current = queue.shift()

    entries = fs.readdirSync(current.path, { withFileTypes: true })

    for entry in entries:
      entryPath = path.join(current.path, entry.name)

      # Reparse point detection — ALL reparse points are skipped (OQ-11).
      # The reason string distinguishes the two cases honestly: a point that
      # resolves outside the root is an escape; one that resolves inside is a
      # deliberate skip to avoid double-counting. Calling both "escape" would
      # tell the user something untrue.
      lstat = fs.lstatSync(entryPath)
      if lstat.isSymbolicLink():
        resolved = fs.realpathSync(entryPath)
        reason = resolved.startsWith(rootPath)
          ? 'reparse-point-skipped'
          : 'reparse-point-escape'
        skippedPaths.add({ path: entryPath, reason })
        continue

      if entry.isDirectory():
        # A directory that is not a symlink may still be a junction.
        resolved = fs.realpathSync(entryPath)
        if resolved !== entryPath:
          # It is a reparse point of some kind — skip it (OQ-11).
          reason = resolved.startsWith(rootPath)
            ? 'reparse-point-skipped'
            : 'reparse-point-escape'
          skippedPaths.add({ path: entryPath, reason })
          continue
        # A real directory: create child node and enqueue
        childNode = new DiskFolderNode(entry.name, entryPath)
        current.node.children.push(childNode)
        queue.push({ path: entryPath, node: childNode })
        directoryCount++

      else if entry.isFile():
        stat = fs.statSync(entryPath)
        fileSize = stat.size
        fileCount++
        scannedBytes += fileSize

        # Aggregate into folder tree
        current.node.sizeBytes += fileSize
        current.node.fileCount++

        # Aggregate into breakdown
        ext = path.extname(entry.name).toLowerCase()
        category = extensionToCategory(ext)
        breakdown[category].totalBytes += fileSize
        breakdown[category].count++

        # Track large files (maintain a sorted top-N)
        if largeFiles.size < N or fileSize > largeFiles.smallest():
          largeFiles.insert({ id, name, path, sizeBytes, extension, lastModified })

        # Progress reporting (every M files)
        if fileCount % 1000 === 0:
          webContents.send('disk:scan-progress', { filesScanned: fileCount, ... })

  # After walk: compute percentages and propagate sizes up the tree
  finalize(rootFolderNode, scannedBytes)
```

### Reparse points (symlinks and junctions)

A reparse point is any filesystem object that redirects to another location. On
Windows, this includes symbolic links (`mklink /D`), junctions (`mklink /J`), and
volume mount points.

**The rule: never follow a reparse point that escapes the scan root.**

Detection:

1. For every entry, call `fs.lstatSync` (which does NOT follow symlinks).
2. If `lstat.isSymbolicLink()` is true, it is a symlink. Resolve it with
   `fs.realpathSync`. If the resolved path is outside the scan root, skip it and
   record `reason: 'reparse-point-escape'`.
3. If the entry is a directory but not a symlink, it may still be a junction.
   Resolve it with `fs.realpathSync`. If the resolved path is outside the scan
   root, skip it and record `reason: 'reparse-point-escape'`.
4. If the resolved path is inside the scan root, proceed normally (it is a
   junction that stays within scope).

Rails:

- **A symlink or junction that resolves outside the root is skipped.** Not
  followed, not counted, not silently included.
- **A symlink or junction that resolves inside the root is also skipped** to
  avoid double-counting (OQ-11: skip all reparse points). The target will be (or
  has already been) counted at its real location.
- **Skipped reparse points are reported in `skippedPaths`, with the reason
  distinguishing the two cases.** A point that resolves outside the root is
  `reparse-point-escape`; one that resolves inside is `reparse-point-skipped`.
  Recording an in-root skip as an "escape" would tell the user something untrue.
- **`fs.realpathSync` is called on directories only, not on files.** Files cannot
  be reparse points (only directories can be junctions/symlinks on NTFS), so
  `lstatSync` on a file is sufficient.

### Long paths

Windows has a traditional `MAX_PATH` limit of 260 characters. Paths longer than
this require the `\\?\` prefix (extended-length path).

- Node.js on Windows supports the `\\?\` prefix natively.
- Before calling `fs.readdirSync` or `fs.statSync`, check if the path exceeds
  260 characters. If so, prefix it with `\\?\`.
- The prefix is stripped before displaying paths in the UI.

Rails:

- **The `\\?\` prefix is added transparently** by the walk implementation. The UI
  never sees it.
- **If a path cannot be prefixed** (e.g. it is a relative path, which `\\?\` does
  not support), skip it and record `reason: 'stat-error'`.
- **Long paths are not truncated.** A truncated path is a wrong path.

### Permission-denied directories

`fs.readdirSync` throws `EACCES` or `EPERM` when the process cannot read a
directory.

- Catch the error, record the path in `skippedPaths` with
  `reason: 'permission-denied'`, and continue with the next directory.
- The walk does not fail as a whole. One inaccessible directory does not abort
  the scan.
- The result reports the count of skipped directories.

Rails:

- **A permission-denied directory is not an error.** It is a skipped path,
  reported honestly.
- **The scan continues** after a permission-denied directory.
- **The UI shows "X directories could not be read"** if any paths were skipped
  for this reason.

### Files that change size mid-scan

A file being written to during the scan may have a different size than it did
when it was enumerated. `fs.statSync` returns the size at the moment of the call.

- The size recorded is the size at `stat` time. That is the best measurement
  available.
- If `fs.statSync` throws (e.g. the file was deleted between `readdirSync` and
  `statSync`), skip it silently — it is gone, no need to report.
- If `fs.statSync` succeeds but the size is 0 for a file that was non-zero during
  `readdirSync` (this is rare but possible with some filesystems), record the 0.
  Do not try to "correct" it.
- The total is a snapshot at scan time, not a guarantee of consistency.

Rails:

- **The size from `fs.statSync` is the size.** No second-guessing, no
  re-statting, no averaging.
- **A file that disappears between `readdirSync` and `statSync` is not counted.**
  It is not in `skippedPaths` either — it simply no longer exists.
- **The result notes that sizes are a snapshot** if any inconsistency was detected
  (e.g. a file whose size changed between two stat calls during aggregation).

### Progress reporting

The walk sends progress events to the renderer via `mainWindow.webContents.send`:

```ts
interface ScanProgressEvent {
  filesScanned: number;
  directoriesScanned: number;
  bytesCounted: number;
  currentPath: string;
}
```

- Events are sent every 1000 files (configurable threshold).
- The renderer shows a progress bar, the current path, and the counts so far.
- There is no percentage complete — the total number of files is not known until
  the walk finishes. Showing a percentage would require a two-pass scan.

Rails:

- **No percentage is shown during the scan.** Only counts.
- **The current path is shown** so the user can see where the scan is.
- **The renderer can offer a cancel button** that stops the walk and returns
  partial results.

### Partial results

If the scan is interrupted (user cancels, app quits, error), return what was
found so far with `complete: false`.

- The `folderTree` contains only the directories that were fully walked.
- `scannedBytes`, `fileCount`, and `directoryCount` reflect what was measured
  before the interruption.
- `largeFiles` contains the top N from what was scanned.
- `breakdown` contains the categories from what was scanned.
- `skippedPaths` contains everything that was skipped.

Rails:

- **Partial results are not discarded.** They are returned with `complete: false`.
- **The UI shows "Scan incomplete — showing partial results"** when `complete` is
  false.
- **The UI does not present partial results as complete.** The `complete` flag
  is always shown.

---

## Contract changes

| Change | Detail |
|---|---|
| `DISK_ANALYZE` return type | `DiskAnalysisResult` instead of the inline type |
| New `DiskAnalysisResult` type | Includes `rootPath`, `driveTotalBytes`, `driveFreeBytes`, `scannedBytes`, `fileCount`, `directoryCount`, `folderTree`, `largeFiles`, `breakdown`, `skippedPaths`, `scanDurationMs`, `complete` |
| New `SkippedPath` type | `{ path: string, reason: 'permission-denied' \| 'reparse-point-escape' \| 'not-found' \| 'stat-error' }` |
| `DiskFolderNode` | `sizeBytes` is now the aggregated subtree sum; `percentage` is relative to `scannedBytes` |
| `FileTypeBreakdown` | `totalBytes` is the sum of actual stat readings; `count` is the number of files |
| New IPC event | `disk:scan-progress` — sent during the walk with counts (not a percentage) |
| `analyzeDisk` parameter | Still takes `drivePath: string` — the root of the walk |
| `totalBytes` / `freeBytes` | Renamed to `driveTotalBytes` / `driveFreeBytes` — from CIM, not from the walk |
| New `scannedBytes` | Sum of all file sizes from the walk — the honest measured total |

The preload contract changes here — this is a breaking change for the renderer.

---

## Files

```
src/main/system/disk-analyzer/
  walk.ts            directory walk with reparse-point, long-path, and permission handling
  categorize.ts      extension-to-category mapping
  result.ts          result assembly, percentage computation, top-N large files
src/main/ipc.ts        replace DISK_ANALYZE handler, add disk:scan-progress event
src/shared/types.ts     new DiskAnalysisResult, SkippedPath types
src/preload/index.ts    update analyzeDisk return type
src/renderer/.../DiskAnalyzer.tsx  progress bar, partial-results banner, real data
scripts/test-disk-analyzer.mjs     pure-logic tests for categorization and aggregation
```

---

## Implementation order

1. `categorize.ts` — extension-to-category mapping, with tests. **No filesystem.**
2. `walk.ts` — directory walk with all edge cases (reparse points, long paths,
   permissions, size changes). **Read-only.**
3. `result.ts` — result assembly, percentage computation, top-N large files.
4. `DISK_ANALYZE` handler — wire up the walk, CIM drive query, and result.
5. `disk:scan-progress` event — progress reporting to the renderer.
6. Renderer — progress bar, partial-results banner, skipped-paths display.

Steps 1-3 are read-only and can land on their own. Step 4 is the first real
scan and should be tested on the owner's Windows machine before shipping.

---

## Verification

Pure logic, runs on the build machine, required before the phase is done:

- Extension-to-category: known extensions map to the right category, unknown
  extensions map to `other`, case-insensitive matching.
- Aggregation: a file's size is added to its parent directory's `sizeBytes` and
  `fileCount`, and to the correct category in `breakdown`.
- Percentage: child percentages sum to approximately 100 (modulo rounding).
- Top-N: the largest files are correctly identified from a set.
- Skipped paths: `reparse-point-escape` (resolved outside the root),
  `reparse-point-skipped` (resolved inside the root), `permission-denied` and
  `not-found` are each recorded with the correct reason. An in-root skip must NOT
  be recorded as an escape.
- No estimation: a file that cannot be stat'd contributes 0 to the total and
  appears in `skippedPaths`.

Windows acceptance, run by the owner:

1. Scan `C:\` — confirm the scan completes, `scannedBytes` is the sum of actual
   file sizes, and `skippedPaths` is populated with real permission-denied paths.
2. Confirm that `driveTotalBytes` (from CIM) is greater than `scannedBytes` —
   the difference is the unscanned portion.
3. Navigate into a folder in `folderTree` — confirm the child sizes sum to the
   parent's size.
4. Cancel a scan mid-way — confirm partial results are returned with
   `complete: false`.
5. Scan a directory containing a junction that points outside the root — confirm
   it is skipped with `reason: 'reparse-point-escape'`.
6. Confirm that `largeFiles` is sorted by size descending and contains real files
   from the disk.

---

## Risks

| Risk | Mitigation |
|---|---|
| A symlink or junction escapes the scan root and the walk follows it into an infinite loop | `fs.realpathSync` resolves the path; if it is outside the root, skip it. Never follow a reparse point that escapes. |
| A long path (>260 chars) causes `fs.readdirSync` to throw | Prefix with `\\?\` before the call. Strip the prefix before displaying. |
| A permission-denied directory aborts the entire scan | Catch the error, record in `skippedPaths`, continue with the next directory. |
| A file's size changes between `readdirSync` and `statSync` | Use the size from `statSync`. The total is a snapshot. Note this in the result. |
| The scan takes too long on a large drive | Send progress events every 1000 files. Offer a cancel button that returns partial results. |
| The walk double-counts files through junctions that stay inside the root | Skip all reparse points, including those that resolve inside the root. The target is counted at its real location. |
| The `extensionToCategory` mapping is incomplete | An unknown extension goes to `other`. The mapping is fixed in code for v1 (OQ-10); extending it is a code change. It is the most likely v2 candidate for user configuration. |
| The result presents `scannedBytes` as the drive's used space | The result includes both `driveTotalBytes` (CIM) and `scannedBytes` (walk). The UI must label them differently. |

---

## Open questions

| # | Question | Blocks |
|---|---|---|
| OQ-9 | ~~Default `N` for `largeFiles`?~~ **Resolved (ROADMAP §8.2): 50.** | Nothing — resolved |
| OQ-10 | ~~Extension→category mapping customizable, or fixed?~~ **Resolved (ROADMAP §8.2): fixed in code for v1.** The most likely v2 candidate for user configuration. | Nothing — resolved |
| OQ-11 | ~~Follow junctions that resolve inside the root, or skip all reparse points?~~ **Resolved (ROADMAP §8.2): skip all reparse points** — double-counting is the worse error. The skip reason distinguishes an escape from an in-root skip. | Nothing — resolved |
| OQ-12 | ~~Drive totals from CIM or `fs.statfs`?~~ **Resolved (ROADMAP §8.2): CIM** (already implemented), degrading to `null` and "not measured" if unavailable. | Nothing — resolved |
