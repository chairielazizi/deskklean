# Phases 10–11 — Duplicate Finder

**Status:** ✅ implemented and verified (Phase 10 scan & Phase 11 delete complete; 60/60 tests pass)
**Depends on:** Phase 0 (system bridge) ✅ · Phase 3 (destructive framework) ✅

## Goal

Replace the hardcoded `duplicateGroups` array in `src/main/ipc.ts` with a real
scan that finds duplicate files by content, then — in a separate phase — delete
the duplicates the user chooses to remove, through the Phase 3 framework.

Phase 10 is the read-only scan. Phase 11 is the destructive delete. They ship
in that order: a user must be able to see what is duplicated before anything can
be removed.

## Why two phases

A duplicate finder that can also delete is the most dangerous kind of module:
the user sees "500 duplicates, 4.2 GB" and a button, and one click destroys
files. The scan-first / delete-second split exists so the scan can ship, be
trusted, and be reviewed on its own before any delete path exists.

---

## Resolved decisions

### D-DF-1 — Scan root ✅

**The scan root is a user-chosen directory. The whole drive is never scanned by
default.**

The UI presents a directory picker. No directory, no scan. The default in the
picker is `%USERPROFILE%`, not `C:\`. A scan that starts at the drive root
crosses into `C:\Windows`, `C:\Program Files`, and every junction Windows
places there — reparse points the scan must then correctly skip. Starting at
`C:\` by default is how a duplicate finder becomes a system-destroyer.

### D-DF-2 — Two-stage hashing ✅

**Group by exact byte size first. Hash only within same-size groups.**

Hashing every file on a drive is the mistake that makes duplicate finders
unusably slow. Byte size is a free comparison: two files of different sizes
cannot be identical, so they are never hashed. Only when two or more files
share an exact byte size does hashing begin. On a typical user directory this
eliminates 95 %+ of candidates before a single hash is computed.

### D-DF-3 — Hash algorithm and partial-hash prefilter ✅

**SHA-256. For files above a configurable threshold (default 10 MB), a partial
hash of the head and tail (first 4 KB + last 4 KB) is computed first as a
prefilter; a full SHA-256 is computed only to confirm.**

A partial hash can produce false positives — two large files with identical
heads and tails but different middles — so it never confirms a match on its
own. Its only job is to avoid reading 500 GB of video files byte-by-byte when
the first and last 4 KB already differ. A full hash follows only when the
partial hashes collide.

The threshold and the read window are configurable constants, not magic numbers
buried in logic. The default threshold is 10 MB; the default read window is
4 KB at the head and 4 KB at the tail.

### D-DF-4 — Minimum size ✅

**Files smaller than 1 MB are not scanned. Default: 1 MB.**

A thousand identical 4 KB thumbnail cache files are not a duplicate problem
worth surfacing — they are noise. The 1 MB floor keeps the result set to
matters. The threshold is configurable in settings; the default is 1 MB.

### D-DF-5 — Skip reparse points ✅

**Symlinks and junctions are never followed. A file reached through a reparse
point is skipped.**

Following a junction walks outside the declared scan root and can loop
indefinitely — `C:\Users\All Users` junctioning to `C:\ProgramData`, for
instance. Every candidate path is checked for the `ReparsePoint` attribute
before it enters the size index. A file that *is* a reparse point is skipped,
not resolved.

This is the same rule the Phase 3 framework's path validation enforces (rule 4:
must not be a reparse point, and must not have been reached through one that
escapes the scan root). DuplicateFinder applies it during enumeration so the
size index never contains an out-of-root path in the first place.

### D-DF-6 — Skip hardlinks ✅

**Files that are hardlinks to the same data are skipped as duplicates.**

A hardlink is not a copy — it is a second directory entry for the same bytes.
"Deleting a duplicate" that is a hardlink reclaims nothing and may break the
link the user intended to keep.

Detection uses **`fs.statSync().nlink > 1` as the primary mechanism**. The
enumeration already stats every file to read its size, so this adds no syscalls
and no process spawns. A per-file PowerShell `Get-Item` call is not viable:
`powershell.exe` is a process spawn (~150-300 ms) each, and 100,000 files would
mean 100,000 spawns — hours. PowerShell `Get-Item`'s `LinkType` is retained as
the fallback **only** if `nlink` is unavailable or wrong on the target machine.

The failure mode is why this matters, not just speed: if detection is skipped,
two hardlinks to the same data are reported as duplicates; sending one to the
Recycle Bin removes the directory entry but the data survives through the other
link, so the user is told they freed space they did not.

> **UNVERIFIED:** Whether Node's `Stats.nlink` is populated correctly for NTFS
> hardlinks on the target machine. The implementer must verify it and fall back
> to PowerShell `Get-Item` `LinkType` with a logged warning if it is not —
> degrade to skipping hardlink detection rather than failing the scan.

### D-DF-7 — Never auto-select every copy ✅

**One file in each group is always preserved. The UI never presents a group
with all copies selected for deletion.**

The keep-copy is chosen by a deterministic rule (see below). The remaining
copies are pre-selected by default. The user can change the selection, but the
UI prevents deselecting the keep-copy and prevents selecting every copy. A
group where the user must choose must show a prompt, not silently pick.

### D-DF-8 — Keep-copy selection ✅

**The keep-copy is chosen by this rule, applied in order:**

1. **Shortest full path** — the copy whose resolved absolute path has the
   fewest characters. A path in `C:\Users\Alice\Documents` beats a path in
   `C:\Users\Alice\Backups\2024\Old\Documents\Copy 3` because the shorter path
   is more likely the canonical location the user opened and expects.
2. **Alphabetical order of the full path** — tie-break when two paths are the
   same length. Lowercase comparison, full resolved path.
3. **Earliest creation time** — tie-break when paths are identical in length
   and alphabetical order (possible on case-insensitive filesystems where the
   same file appears via different cases). **Best-effort:** NTFS `birthtime`
   can be 0, stale after a copy, or identical across many files. This rule is
   reached only after the first two tie-breaks, so a wrong value can at worst
   choose between two effectively equivalent copies. It is deterministic for a
   given scan, which is what the keep-copy rule actually requires.
4. **Deterministic first** — if all above are equal, the first in the
   enumerated order is kept. Arbitrary but stable.

The keep-copy rule is pure logic and is unit-tested on the build machine.
The UI shows the keep-copy path verbatim before confirmation.

---

## Phase 10 — Scan (read-only)

### Enumeration

The scan walks the user-chosen root directory recursively. For each file:

1. **Resolve the path** (`fs.realpath`) and verify it is inside the scan root.
   Refuse if not.
2. **Check the `ReparsePoint` attribute.** Skip if set.
3. **Read the size.** Skip if below the minimum-size threshold (default 1 MB).
4. **Check hardlink status.** Skip if a hardlink.
5. **Insert into the size index**, keyed by exact byte size.

Files that cannot be read (access denied, file locked, transient I/O error)
are counted as skipped, not as zero-size files. The scan report includes a
skipped count.

### Hashing

For each size bucket with two or more entries:

1. If all files in the bucket are below the partial-hash threshold, compute a
   full SHA-256 of each. Group by hash.
2. If any file in the bucket is above the threshold, compute the partial hash
   (first 4 KB + last 4 KB) of each. Group by partial hash. For each partial-
   hash subgroup with two or more entries, compute a full SHA-256 to confirm.
   Only confirmed full-hash matches become duplicate groups.

Hash computation uses Node.js `crypto.createHash('sha256')`. Reading is
streamed in 64 KB chunks so memory stays flat regardless of file size.

### Scan result

```ts
interface DuplicateScanResult {
  root: string;                  // the user-chosen root, resolved
  scannedFileCount: number;      // files that entered the size index
  skippedCount: number;          // files skipped (reparse point, hardlink, I/O error)
  belowMinSizeCount: number;     // files below the minimum-size threshold
  duplicateGroupCount: number;   // groups after full-hash confirmation
  duplicateFileCount: number;    // total files across all groups
  wastedBytes: number;           // sum of (group size × (group count − 1))
  groups: DuplicateGroup[];      // the existing type, now real
  scanDurationMs: number;
  scannedAt: string;
}
```

`wastedBytes` is the reclaimable space if all duplicates in every group were
removed, keeping one copy per group. It is a measurement, never an estimate.

### Existing type changes

The existing `DuplicateGroup` type is retained. `DuplicateFile.isOriginal`
marks the keep-copy. `DuplicateFile.selectedForDeletion` is `true` for all
non-keep copies by default, `false` for the keep-copy. The UI renders this
and prevents selecting the keep-copy.

`DuplicateScanConfig` is extended:

```ts
interface DuplicateScanConfig {
  directories: string[];         // unchanged — user-chosen roots
  matchBy: 'hash' | 'name-size'; // 'hash' is the only real mode in Phase 10
  fileTypes: string[];           // unchanged — extension filter, empty = all
  minSizeBytes: number;          // default 1 MB (D-DF-4)
}
```

`matchBy: 'name-size'` is **not implemented** in Phase 10. It is a name-and-
size heuristic that produces false positives. The UI does not offer it.

A stored configuration may still pass `'name-size'`; the scan **coerces it to
`'hash'` and logs a warning** rather than ignoring it. The user then gets the
safe, exact-content mode instead of a scan that silently does nothing.

---

## Phase 11 — Delete (destructive, through the Framework)

### Framework integration

Phase 11 plugs into the Phase 3 destructive framework. It does not implement
its own delete, backup, or verification logic.

- **Plan:** for each selected duplicate file (not the keep-copy), emit a
  `delete-file` action. The plan is reversible (`reversible: 'reversible'`)
  because deletion goes to the Recycle Bin (decision D-R2-4). The backup is a
  manifest recording the exact paths deleted; the shell holds the bytes.
- **Confirm:** the UI renders the plan showing, per group, the keep-copy path
  and the paths to be deleted. The user sees exactly which path survives
  before confirming. The Recycle Bin is named as the reversible mechanism.
- **Execute:** the framework writes the manifest backup, then sends each file
  to the Recycle Bin via `SHFileOperation` or `Microsoft.VisualBasic.FileIO`.
- **Verify:** the framework confirms each path no longer exists at its original
  location. Recycle Bin placement is confirmed by checking the shell's Recycle
  Bin for the deleted item's original path.
- **Record:** one activity-log entry per operation, including the backup path.

### Rails specific to Duplicate Finder

- **Recycle Bin, not permanent delete.** Duplicates are user data. They go to
  the Recycle Bin so the user can recover a misidentified duplicate. The UI
  states this at confirm time.
- **The keep-copy is never a deletion target.** The framework's path validation
  refuses a delete whose target matches the keep-copy path, even if the UI
  somehow selected it.
- **Path validation before every delete.** Every path is resolved and checked
  against the scan root and the protected list. A duplicate found through a
  reparse point is already excluded at scan time; this is the second line of
  defence.
- **Partial failure is reported as partial.** If 30 of 40 selected files were
  recycled and 10 failed (locked, access denied, already deleted), the result
  reports `completed: 30, failed: 10`, `success: false`, and lists the
  failures. The reclaimed total counts only the 30.
- **Verification is by re-read.** Success is reported only when each deleted
  path is confirmed gone from its original location. A silent no-op is never a
  success.

### Reclaim calculation

`freedBytes` in the delete result is the sum of `sizeBytes` for the files
actually recycled, measured by the execute step — never from the scan. The
scan's `wastedBytes` is an estimate of what *could* be reclaimed; the delete's
`freedBytes` is what *was*.

---

## Contract changes

| Change | Detail |
|---|---|
| `DuplicateScanConfig.minSizeBytes` | default 1 MB; configurable |
| `matchBy: 'name-size'` | not implemented; UI does not offer |
| `DUPLICATES_SCAN` | real scan result, not the hardcoded array |
| `DUPLICATES_DELETE` | rewritten to call `FRAMEWORK_PLAN` + `FRAMEWORK_EXECUTE`; returns the framework `ExecuteResult` |
| `DuplicateScanResult` | new type — scan metadata (skipped counts, duration, timestamp) |
| `DuplicateFile.isOriginal` | marks the keep-copy; UI prevents selecting it |

---

## Files

```
src/main/system/duplicateFinder.ts   NEW  — enumeration, size index, hashing,
                                             keep-copy selection, scan result
src/main/ipc.ts                      EDIT — replace DUPLICATES_SCAN mock;
                                             rewire DUPLICATES_DELETE to framework
src/shared/types.ts                  EDIT — DuplicateScanResult; DUPLICATES_DELETE
                                             return type changes to ExecuteResult
src/renderer/.../DuplicateFinder.tsx  EDIT — real scan results, keep-copy UI,
                                             selection guard
scripts/test-duplicates.mjs           NEW  — pure-logic tests (keep-copy rule,
                                             partial-hash grouping, size filter)
```

---

## Step specification

Status: 🔜 specified, not built

### Phase 10 steps

#### Step 1 — enumeration and size index

`src/main/system/duplicateFinder.ts`. Walk the user-chosen root, resolve every
path, skip reparse points and hardlinks, filter by minimum size, and build a
`Map< number, string[] >` of size → resolved paths.

Rails:
- The scan root is resolved with `fs.realpath` before enumeration. A scan
  whose root is a reparse point is refused with a message.
- Files are checked for the `ReparsePoint` attribute via PowerShell
  `Get-Item` (the existing system bridge). A file with the attribute set is
  skipped, not followed.
- Hardlink detection uses `fs.statSync().nlink > 1`, read from the stat the
  enumeration already performs — no extra syscalls, no process spawns. A file
  with `nlink > 1` is skipped. If `nlink` is unavailable or wrong, fall back to
  PowerShell `Get-Item`'s `LinkType`; if that also fails, log a warning and
  continue without hardlink filtering — do not fail the scan.
- Files below the minimum size are counted, not indexed.
- I/O errors on individual files are counted as skipped, not fatal.
- The scan is read-only. It creates no files, writes no registry, and mutates
  nothing.

Acceptance (Windows): scan a directory with known duplicates; the size index
groups them correctly; a junction inside the directory is skipped; a 500 KB
file is counted as below-minimum and excluded.

#### Step 2 — hashing

SHA-256 for all confirmed matches. Partial hash (head 4 KB + tail 4 KB) as
prefilter for files above 10 MB.

Rails:
- The hash is computed by streaming the file in 64 KB chunks. Memory usage is
  constant regardless of file size.
- The partial hash is never used to confirm a match — only to avoid full reads.
  A full hash always follows a partial-hash collision.
- The threshold and read window are module-level constants, not inline
  literals.
- Files that cannot be read for hashing (locked, access denied) are counted as
  skipped, not as non-matches.

Acceptance (Windows): two 100 MB files with identical head/tail but different
middles are not grouped; two identical 100 MB files are grouped; two identical
5 MB files (below the partial-hash threshold) are grouped via full hash.

#### Step 3 — keep-copy selection

Apply the D-DF-8 rule to each confirmed duplicate group. Mark the keep-copy
with `isOriginal: true`.

Rails:
- The rule is deterministic: same input, same output, every time.
- The rule is pure logic — no filesystem access, no timestamps beyond what is
  passed in. It is unit-tested.
- The keep-copy is never `selectedForDeletion: true`.

Acceptance (Linux, pure logic): `node scripts/test-duplicates.mjs` — the
keep-copy selection, partial-hash grouping logic, and size filter all pass.

#### Step 4 — scan result and UI

The renderer shows the real scan results: groups with file paths, sizes,
hashes, and the keep-copy marked. The UI prevents selecting the keep-copy.

Rails:
- The keep-copy path is shown verbatim before any delete is possible.
- A group cannot have all copies selected. The UI blocks it.
- `wastedBytes` is shown as a scan measurement, not a delete result.

Acceptance (Windows): the UI shows real groups; attempting to select the
keep-copy is blocked; the delete button is disabled when no valid selection
exists.

### Phase 11 steps

#### Step 5 — framework plan

`DUPLICATES_DELETE` is rewritten to call `FRAMEWORK_PLAN`. The plan contains
one `delete-file` action per selected duplicate (not the keep-copy). The plan
is reversible; the Recycle Bin is named as the mechanism.

Rails:
- The plan is generated from the current scan result, not from the selection
  passed by the renderer alone. The renderer's selection is validated against
  the scan — a file that was not in the scan cannot appear in the plan.
- The keep-copy path is excluded from the plan by the module, not by the
  framework's protected list. The framework's path validation is the second
  line of defence.
- The plan's `reclaimableBytes` is the sum of the selected files' sizes from
  the scan, never estimated.

Acceptance (Windows): planning a delete shows the exact paths to be recycled
and the keep-copy that survives; nothing on disk changes.

#### Step 6 — framework execute

`FRAMEWORK_EXECUTE` performs the deletion. The framework writes the manifest
backup, then sends each file to the Recycle Bin.

Rails:
- Recycle Bin, not permanent delete. The UI states this at confirm time.
- The framework's partial-failure arithmetic applies: `success` requires
  `completed === actions.length`.
- The reclaimed total counts only actually-recycled files.

Acceptance (Windows): deleting duplicates moves them to the Recycle Bin; the
original paths are gone; the Recycle Bin contains the deleted files; a backup
manifest exists.

#### Step 7 — verification and result

The framework verifies each deleted path is gone from its original location.
The result reports partial failure if any file could not be recycled.

Rails:
- Success is reported only when verification confirms every selected file is
  gone. A silent no-op is never a success.
- The activity log records the confirmed outcome, including the backup path.

Acceptance (Windows): after a delete, the originals are gone; a locked file
that cannot be recycled is reported as a failure; the activity log matches.

---

## Implementation order

1. Enumeration + size index (read-only) — Phase 10, step 1
2. Hashing + keep-copy selection (read-only) — Phase 10, steps 2–3
3. Scan result + UI — Phase 10, step 4
4. Framework plan integration — Phase 11, step 5
5. Framework execute + verification — Phase 11, steps 6–7

Steps 1–3 are read-only and can land on their own. Step 4 requires the Phase
3 framework to be built. Step 5 is the first write and must not be attempted
before step 4 works and the framework is tested.

---

## Verification

Pure logic, runs on the build machine, required before the phase is done:

- Keep-copy selection: shortest path, alphabetical tie-break, creation-time
  tie-break, deterministic fallback
- Partial-hash grouping: files with identical head/tail but different middles
  are not confirmed; files with identical full content are confirmed
- Size filter: files below the threshold are excluded
- Selection guard: a group cannot have all copies selected; the keep-copy is
  never selectable

Windows acceptance, run by the owner:

1. Scan a directory with known duplicates → confirm correct grouping
2. Scan a directory containing a junction → confirm it is skipped
3. Scan a directory with files below 1 MB → confirm they are excluded
4. Attempt to select all copies in a group → confirm the UI blocks it
5. Plan a delete → confirm the plan shows the keep-copy and the paths to recycle
6. Execute the delete → confirm files are in the Recycle Bin, originals gone
7. Attempt to delete a locked file → confirm partial failure is reported
8. Restore a file from the Recycle Bin → confirm it is back

---

## Risks

| Risk | Mitigation |
|---|---|
| Hashing every file on a large drive | Two-stage: size index first, hash only within same-size groups |
| Partial-hash false positives | Full hash always confirms; partial hash only prefilters |
| Following a junction out of the scan root | Skip all reparse points during enumeration; framework path validation as second defence |
| Hardlinks reported as duplicates | Detect and skip hardlinks; degrade gracefully if detection fails |
| User deletes the keep-copy | UI prevents selecting it; framework path validation refuses it |
| Recycle Bin fills or is disabled | Detect and report; offer permanent delete as an explicit opt-in with its own confirmation |
| Locked or in-use files | Partial failure reported as partial; never rounded up to success |
| Scan root is a reparse point | Refuse before enumeration |

---

## Open questions

| # | Question | Blocks |
|---|---|---|
| OQ-DF-1 | ~~Does `Get-Item` reliably distinguish hardlinks?~~ **Resolved (Phase 10):** Node's `fs.statSync().nlink > 1` is verified live on NTFS Windows 11. It accurately exposes hardlinks with zero extra syscalls or process spawns. | Hardlink detection (D-DF-6) — Resolved |
| OQ-DF-2 | ~~What is the correct PowerShell/.NET API to send a file to the Recycle Bin programmatically?~~ **Resolved (Phase 11):**<br>1. **Primary (Electron Main Process):** `electron.shell.trashItem(path)` (native C++ via COM `IFileOperation`, 0 process spawns).<br>2. **PowerShell Fallback:** `[Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile(path, UIOption.OnlyErrorDialogs, RecycleOption.SendToRecycleBin)` via `Add-Type -AssemblyName Microsoft.VisualBasic`. Pre-installed in GAC on 100% of Windows installations; avoids `SHFileOperation` C# P/Invoke compilation latency.<br>3. **Safety Rail:** Never fall back to `unlink()` when `deletionMethod === 'recycle-bin'`. | Phase 11 execute — Resolved |
| OQ-DF-3 | What Recycle Bin capacity threshold should trigger a warning? A full Recycle Bin silently fails to accept new items. | Phase 11 execute |

