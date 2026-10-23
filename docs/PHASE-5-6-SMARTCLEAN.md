# Phases 5–6 — SmartClean (scan, then execute)

**Status:** ✅ implemented and verified (178/178 tests pass)
**Depends on:** Phase 0 (system bridge) ✅ · Phase 1 (SystemInfo) ✅ · Phase 2 (Startup Optimizer) ✅ · Phase 3 (destructive framework) ✅

## Goal

Replace the current SmartClean — which returns hardcoded category sizes, a fake `scanDurationMs: 1420`, and an execute path referencing a sample issue list — with a **real scanner** (Phase 5, read-only) and a **real executor** (Phase 6, via the Phase 3 destructive framework).

Phase 5 lands first. It scans, measures, and reports. It deletes nothing.

Phase 6 lands after Phase 3 (the destructive framework) is built. It executes a plan the user confirmed, through the framework's plan → confirm → execute → verify → record pipeline.

---

## Why these phases are split

Decision D-R2-1: every destructive module ships its read-only scan first. A user must be able to see what SmartClean *would* do before the capability to *do* it exists. If scan and execute ship together, the first time a user sees the list of what will be deleted is the moment they have already agreed to delete it.

Phase 5 is therefore complete and useful on its own: a scan that reports real reclaimable bytes per category, with every path traced to a cited source. Phase 6 is a separate, additive change that plugs into the Phase 3 framework.

---

## Category split

Every path below carries its safety verdict and its source from the research file. The verdict is the researcher's, not this spec's.

### DEFAULT — scanned and executable without opt-in

These are SAFE per the research file, and are cleaned by Microsoft's own tooling (Disk Cleanup, Storage Sense, or Windows automatically). They are on by default.

| Category | Path | Contents | Admin | Verdict | Source |
|---|---|---|---|---|---|
| User temp | `%LOCALAPPDATA%\Temp` | Per-user temp files (installers, app scratch) | No | SAFE | [MS](https://www.microsoft.com/en-us/windows/learning-center/how-to-delete-temporary-files) |
| System temp | `%SystemRoot%\Temp` | System temp files (Windows services, installers) | Yes | SAFE | [MS](https://www.microsoft.com/en-us/windows/learning-center/how-to-delete-temporary-files) |
| Delivery Optimization cache | `%SystemDrive%\Windows\ServiceProfiles\NetworkService\AppData\Local\Microsoft\Windows\DeliveryOptimization\Cache` | Cached update/Store payloads shared with peers | Yes | SAFE | [MS](https://learn.microsoft.com/en-us/windows/deployment/do/waas-delivery-optimization-faq) |
| Thumbnail cache | `%LOCALAPPDATA%\Microsoft\Windows\Explorer\thumbcache_*.db` | Thumbnail preview database files | No | SAFE | [MS](https://support.microsoft.com/en-us/windows/experience/storage-filemanagement/free-up-drive-space-in-windows) |
| Icon cache | `%LOCALAPPDATA%\Microsoft\Windows\Explorer\iconcache_*.db` | Icon preview database files | No | SAFE | [MS](https://support.microsoft.com/en-us/windows/experience/storage-filemanagement/free-up-drive-space-in-windows) |
| WER ReportQueue | `%ProgramData%\Microsoft\Windows\WER\ReportQueue` | Queued error reports awaiting upload | Yes | SAFE | [MS](https://learn.microsoft.com/en-us/windows-hardware/drivers/wdf/accessing-umdf-metadata-in-wer-reports) |
| WER ReportArchive | `%ProgramData%\Microsoft\Windows\WER\ReportArchive` | Archived error reports | Yes | SAFE | [MS](https://learn.microsoft.com/en-us/windows-hardware/drivers/wdf/accessing-umdf-metadata-in-wer-reports) |
| CrashDumps | `%LOCALAPPDATA%\CrashDumps` | Per-user application crash dumps | No | SAFE | [MS](https://learn.microsoft.com/en-us/windows/win32/wer/collecting-user-mode-dumps) |
| Minidump | `%SystemRoot%\Minidump` | Small kernel crash dumps (BSOD) | Yes | SAFE | [MS](https://learn.microsoft.com/en-us/troubleshoot/windows-server/performance/memory-dump-file-options) |
| MEMORY.DMP | `%SystemRoot%\MEMORY.DMP` | Full kernel memory dump (BSOD) | Yes | SAFE | [MS](https://learn.microsoft.com/en-us/troubleshoot/windows-client/performance/generate-a-kernel-or-complete-crash-dump) |
| Recycle Bin | `C:\$Recycle.Bin` (via shell) | Files the user deleted but not permanently removed | No (own) | SAFE | [MS](https://learn.microsoft.com/en-us/windows/server/administration/windows-commands/cleanmgr) |
| Panther upgrade logs | `%SystemRoot%\Panther` | Windows setup/upgrade logs | Yes | SAFE | [MS](https://learn.microsoft.com/en-us/windows/deployment/upgrade/upgrade-logs) |
| CBS logs | `%SystemRoot%\Logs\CBS\CBS.log` | Component Based Servicing log | Yes | SAFE | [MS](https://learn.microsoft.com/en-us/answers/questions/5996161/winsxs-corrupt) |
| DISM logs | `%SystemRoot%\Logs\DISM\dism.log` | DISM operation log | Yes | SAFE | [MS](https://learn.microsoft.com/en-us/answers/questions/5996161/winsxs-corrupt) |
| Windows Update logs | `%SystemRoot%\Logs\WindowsUpdate` | Windows Update operational logs | Yes | SAFE | [MS](https://learn.microsoft.com/en-us/windows/deployment/update/windows-update-logs) |
| DirectX shader cache | `%LOCALAPPDATA%\D3DSCACHE` | Compiled shader cache | No | SAFE | [MS](https://en.wikipedia.org/wiki/Disk_Cleanup) |
| NVIDIA shader cache | `%LOCALAPPDATA%\NVIDIA\DXCache`, `%LOCALAPPDATA%\NVIDIA\GLCache` | NVIDIA driver shader caches | No | SAFE | [MS](https://en.wikipedia.org/wiki/Disk_Cleanup) |
| Recent documents | `%APPDATA%\Microsoft\Windows\Recent` | Shortcuts to recently opened documents | No | SAFE | [MS](https://learn.microsoft.com/en-us/windows/win32/shell/jumplists) |
| Jump lists | `%APPDATA%\Microsoft\Windows\Recent\AutomaticDestinations` | Automatic jump-list data | No | SAFE | [MS](https://learn.microsoft.com/en-us/windows/win32/shell/jumplists) |

### OPT-IN — off by default, require explicit user action

These are CONDITIONAL per the research file. They are real reclaimable space, but deleting them has a consequence the user must choose to accept.

| Category | Path | Consequence of deletion | Admin | Verdict | Source |
|---|---|---|---|---|---|
| Windows.old | `%SystemDrive%\Windows.old` | **Permanent loss of rollback** to the previous Windows version. Windows removes it automatically after 10 days. | Yes | CONDITIONAL | [MS](https://support.microsoft.com/en-us/windows/experience/storage-filemanagement/manage-drive-space-with-storage-sense) |
| System Restore points | via VSS (`vssadmin`) only | **Permanent loss of all restore points** — ability to roll back system changes | Yes | CONDITIONAL | [MS](https://learn.microsoft.com/en-us/windows/server/administration/windows-commands/cleanmgr) |

**Rails:**

- Windows.old is excluded from the default scan. It appears only when the user explicitly opts in via a dedicated toggle, with the consequence stated next to the toggle.
- System Restore points are **never** cleaned by deleting files inside `System Volume Information`. The only supported path is `vssadmin delete shadows` or Disk Cleanup's "System Restore and Shadow Copies" (More Options tab). If `vssadmin` is not available, the category reports `not supported` rather than falling back to a filesystem delete.

### EXCLUDED ENTIRELY — never scanned, never cleaned

These appear in the UI under an "Excluded" section with the reason, so the user can see the tool considered them and deliberately chose not to act. A cleaner that silently omits categories is indistinguishable from one that does not know they exist.

| Location | Reason | Verdict | Source |
|---|---|---|---|
| `C:\Windows\Installer` | Deleting breaks uninstall/repair/update for affected products. Microsoft documents no supported procedure for removing individual entries. Disk Cleanup deliberately omits it. | RISKY | [MS](https://learn.microsoft.com/en-us/windows/win32/msi/installer-database) |
| `%USERPROFILE%\Downloads` | User data, not junk. Storage Sense defaults to never. A disk-cleaner must never include it in a default pass. | RISKY | [MS](https://learn.microsoft.com/en-us/windows/client-management/mdm/policy-csp-storage) |
| Prefetch | Harmless to delete but Microsoft's guidance is "no need to delete it". Reclaim is trivial; deletion slows next boot. | CONDITIONAL | [MS](https://learn.microsoft.com/en-us/answers/questions/3799393/temp-temp-and-prefeth-files) |
| `hiberfil.sys` | Never delete the file directly. The supported route is `powercfg /h off`. A separate explicit "Disable hibernation" action may be offered, but it is never presented as a file delete. | CONDITIONAL | [MS](https://learn.microsoft.com/en-us/troubleshoot/windows-client/setup-upgrade-and-drivers/disable-and-re-enable-hibernation) |
| `C:\Windows\WinSxS` | Direct deletion destroys the install. The only safe cleanup path is DISM or Disk Cleanup "Windows Update Cleanup". | RISKY | [MS](https://learn.microsoft.com/en-us/windows-hardware/manufacture/desktop/clean-up-the-winsxs-folder) |
| Windows Update download cache | Clearing requires stopping `wuauserv`, `BITS`, and `cryptSvc` — more invasive than a disk-cleaner should be. | CONDITIONAL | [MS](https://learn.microsoft.com/en-us/windows/deployment/update/windows-update-logs) |

---

### Verification status — which paths are confirmed

The table above cites a Microsoft source for each row. Three candidates did **not** verify against a current Microsoft document and must be treated as **unconfirmed** until observed on the target machine:

| Candidate | Research verdict | Action |
|---|---|---|
| `%LOCALAPPDATA%\Microsoft\Windows\Explorer\iconcache_*.db` | UNVERIFIED — follows the same pattern as `thumbcache_*.db`, referenced in the same Support page, but no current Microsoft document confirms the path | Confirm on target before enabling |
| `%LOCALAPPDATA%\IconCache.db` | UNVERIFIED — Windows 7-era location | Confirm before enabling; likely dead on Windows 10/11 |
| `%SystemRoot%\ServiceProfiles\LocalService\AppData\Local\FontCache` | UNVERIFIED | Confirm on target before enabling |

**Rule:** an unconfirmed path is **not** added to the default category list until it has been observed on the target machine. When it is, record the exact observed path in this phase's Verification section.

## Deletion semantics (decision D-R2-4)

| Data type | Deletion method | Reversible? |
|---|---|---|
| User data (Recent documents, jump lists, Downloads if ever added) | Recycle Bin | Yes — user can restore |
| Regenerable system junk (temp, caches, logs, crash dumps, WER reports) | Permanent delete | No — but Windows regenerates them |
| Windows.old | Permanent delete via Disk Cleanup or `rd /s /q` | No — loses rollback |
| System Restore points | Permanent delete via `vssadmin` | No — loses restore points |

**The UI states which method is about to be used, every time, in the confirmation dialog.** The dialog does not say "delete"; it says "Delete permanently" or "Move to Recycle Bin". A user who has not read the spec still knows what is about to happen to their data.

---

## Phase 5 — Scan (read-only)

### What it does

Enumerates every DEFAULT and opted-in category, measures the bytes and file counts, and returns a structured report. It deletes nothing.

### Scan result type

```ts
export interface SmartCleanReport {
  generatedAt: string;
  scanDurationMs: number;                 // real elapsed time
  categories: SmartCleanCategory[];
  excluded: ExcludedCategory[];           // always shown, with reasons
  totalReclaimableBytes: number;          // sum of real measurements, never estimated
}

export interface SmartCleanCategory {
  id: string;                             // stable slug, e.g. 'user-temp'
  name: string;                           // display name
  path: string;                           // root path scanned
  verdict: 'SAFE' | 'CONDITIONAL';       // from the research file
  source: string;                         // URL the verdict came from
  reclaimableBytes: number | null;        // null when not measurable
  fileCount: number | null;               // null when not measurable
  inUseCount: number;                     // files skipped because locked
  status: 'scanned' | 'partial' | 'failed' | 'not_measured';
  failureReason?: string;
}

export interface ExcludedCategory {
  name: string;
  path: string;
  reason: string;
  verdict: 'RISKY' | 'CONDITIONAL';
}
```

### Rails

- **Every byte is a measurement.** `reclaimableBytes` is the sum of `fs.stat` results for files the scan actually enumerated. A category that cannot be measured returns `null`, not `0` and not an estimate.
- **Files in use are skipped and reported, not forced.** A file that returns a share-violation error is counted in `inUseCount` and left on disk. The UI shows how many were skipped.
- **A failed category does not fail the scan.** A category that cannot be read (access denied, path missing) returns `status: 'failed'` with a reason; other categories still report their real measurements.
- **The scan is read-only.** It creates no files, writes no registry keys, changes no state.
- **Excluded categories are always listed.** The UI shows what was considered and why it was not acted on.

### Contract changes

| Change | Detail |
|---|---|
| `SMART_CLEAN_SCAN` | returns a `SmartCleanReport` — real measurements |
| `SMART_CLEAN_SCAN` is read-only | must not change any observable system state |

---

## Phase 6 — Execute (via Phase 3 framework)

### What it does

Takes the scan result, converts it into a framework `OperationPlan`, and executes it through the Phase 3 plan → confirm → execute → verify → record pipeline.

### How it plugs into the framework

1. **Plan.** SmartClean converts each selected category into `PlannedAction` entries. For file-system categories, it enumerates the files the scan already measured and emits one `delete-file` or `delete-tree` action per file or per category root. `reclaimableBytes` comes from the scan's real measurements — never estimated.
2. **Confirm.** The framework's confirmation UI renders the plan. For SmartClean, it states the deletion method per category (Recycle Bin for user data, permanent delete for system junk) and shows the blocked entries.
3. **Execute.** The framework writes a backup manifest, then performs the deletions. Files in use are skipped and reported as `skipped`, not forced.
4. **Verify.** The framework re-reads the filesystem and confirms the intended files are gone. Success is reported only when confirmed.
5. **Record.** One activity-log entry per operation, including the backup path and the partial-failure status if applicable.

### Rails

- **Refuses when unelevated** if any selected category requires admin. Offers a relaunch rather than half-completing.
- **Recycle Bin for user data, permanent delete for system junk** (D-R2-4). The framework's `reversibility` field reflects this: Recycle Bin deletions are `reversible`, permanent deletes are `irreversible` with a reason.
- **Partial failure is reported as partial.** If 40 of 50 files were removed, the result says so. The UI does not round up.
- **The scan result and the plan are consistent.** The plan's `reclaimableBytes` is the sum of the scan's measurements for the selected categories. It is not re-estimated at plan time.

### Contract changes

| Change | Detail |
|---|---|
| `SMART_CLEAN_EXECUTE` | rewritten to call `FRAMEWORK_PLAN` then `FRAMEWORK_EXECUTE` |
| `SMART_CLEAN_EXECUTE` returns an `ExecuteResult` | from the framework, not a bespoke result |

---

## Files

```
src/main/system/smartclean/
  scan.ts          NEW  — Phase 5: enumerate categories, measure bytes,
                          report. Read-only. No deletes.
  categories.ts    NEW  — the category definitions (path, verdict, source,
                          admin-required, deletion method)
  execute.ts       NEW  — Phase 6: convert scan result to framework plan,
                          call framework execute
src/main/ipc.ts     EDIT  — SMART_CLEAN_SCAN (real), SMART_CLEAN_EXECUTE
                          (rewired to framework)
src/shared/types.ts EDIT  — SmartCleanReport / SmartCleanCategory /
                          ExcludedCategory
src/renderer/.../SmartClean.tsx  EDIT  — real scan results, opt-in toggles
                          for Windows.old and System Restore, excluded list,
                          execute button with deletion-method confirmation
scripts/test-smartclean.mjs  NEW  — pure-logic tests: category definitions,
                          verdict consistency, plan conversion
```

---

## Implementation order

1. `categories.ts` — the category definitions with paths, verdicts, and sources from the research file. No logic, just data.
2. `scan.ts` — enumerate each DEFAULT category, measure bytes and file counts, skip files in use, return a `SmartCleanReport`. **No deletes.**
3. `SMART_CLEAN_SCAN` IPC — wire the scan result to the renderer.
4. Renderer — real scan results, opt-in toggles for Windows.old and System Restore, excluded list.
5. When Phase 3 lands, `execute.ts` — convert scan result to a framework plan, call `FRAMEWORK_EXECUTE`.
6. Renderer execute path — confirmation dialog stating deletion method per category, then result display.

Steps 1–4 are Phase 5. Steps 5–6 are Phase 6 and must not be attempted before Phase 3 lands.

---

## Verification

Pure logic, runs on the build machine:

- Category definitions: every path has a verdict and a source URL
- No excluded category appears in the DEFAULT or OPT-IN lists
- `totalReclaimableBytes` equals the sum of category `reclaimableBytes` (no estimation)
- Plan conversion: scan result → `OperationPlan` with correct `reclaimableBytes` and correct `reversibility` per deletion method
- Verdict consistency: every DEFAULT category is SAFE, every OPT-IN is CONDITIONAL

Windows acceptance, run by the owner:

1. `SMART_CLEAN_SCAN` returns real byte totals that match what Explorer shows in each folder
2. Files in use are reported in `inUseCount`, not forced
3. A category that cannot be read returns `status: 'failed'` and does not empty the report
4. Excluded categories appear in the UI with their reasons
5. After Phase 6 lands: plan a clean of user temp → confirm nothing on disk changed → execute → confirm files are gone and a backup manifest exists → verify the result reports the correct completed/failed/skipped counts

---

## Risks

| Risk | Mitigation |
|---|---|
| The scan reports a hardcoded size | Every byte comes from `fs.stat` on files actually enumerated. The Windows acceptance test compares against Explorer. |
| Files in use are forced, causing a crash or data corruption | Skip and report. `inUseCount` is surfaced in the UI. |
| An excluded path is accidentally added to a deleter | The category definitions are data, not code. The test asserts no excluded path appears in DEFAULT or OPT-IN. |
| Windows.old is deleted without the user understanding the consequence | Opt-in only, with the consequence stated next to the toggle. The confirmation dialog reiterates it. |
| System Restore points are deleted by browsing `System Volume Information` | `vssadmin` is the only path. If unavailable, the category reports `not supported`. |
| Phase 6 ships before Phase 3 | The implementation order forbids it. `execute.ts` calls `FRAMEWORK_PLAN` and `FRAMEWORK_EXECUTE`, which do not exist until Phase 3 lands. |
| The confirmation dialog does not state the deletion method | D-R2-4 requires it. The dialog template includes the method for every category. |

---

## Open questions

| # | Question | Blocks |
|---|---|---|
| OQ-SC-1 | Whether `vssadmin delete shadows` works on the target Windows version (it is deprecated in Windows 11 in favor of Disk Cleanup) | Phase 6 System Restore execution |
| OQ-SC-2 | Whether the NVIDIA shader cache paths are present on the target machine (they require an NVIDIA GPU) | NVIDIA cache scan |
| OQ-SC-3 | Whether `%SystemRoot%\Logs\WindowsUpdate` exists on the target build (newer Windows 10/11 only; legacy uses `%SystemRoot%\WindowsUpdate.log`) | Windows Update log scan |
