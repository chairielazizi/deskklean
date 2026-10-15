# Phase 3 — Shared destructive-operation framework

The keystone phase. Six modules destroy data; none of them gets to invent its own
backup, confirmation or verification logic. They all plug into this.

Status: 🔜 specified, not built. Blocks phases 6, 8, 11, 12, 14.

---

## Goal

Provide one implementation of: plan → confirm → execute → verify → record, with
central enforcement of a protected list, path validation, reversibility declaration
and partial-failure reporting. A module supplies *what* to change; the framework owns
*how it is allowed to happen*.

---

## Why this phase exists

Six modules delete or modify things. If each grows its own backup and undo logic,
that is six independent chances to repeat the bug already found in Phase 2, where the
rollback `DELETE` entry was emitted for folder items but not registry items — a
rollback that silently did not roll back. That class of defect is invisible to type
checking and only shows up when a user tries to undo.

The framework makes the safe path the only path:

- A module cannot execute without having produced a plan first.
- A module cannot skip the backup, because the framework writes it.
- A module cannot claim success without verification, because the framework verifies.
- A module cannot touch a protected path, because the framework refuses before the
  module is consulted.

---

## The contract

Five steps. A module implements `plan`; the framework implements the rest.

### 1. Plan

A dry run. Enumerates exactly what would change and **changes nothing**.

```ts
export type ActionKind =
  | 'delete-file'
  | 'delete-tree'
  | 'overwrite-file'
  | 'registry-value'
  | 'registry-key'
  | 'scheduled-task'
  | 'uninstall';

export interface PlannedAction {
  id: string;                    // stable within the plan, for reporting
  kind: ActionKind;
  target: string;                // absolute resolved path, or a registry path
  description: string;           // shown verbatim to the user at confirm time
  reclaimableBytes: number | null;  // null when genuinely unknown - never estimated
}

export interface BlockedAction {
  target: string;
  reason: string;                // why the protected list or validation refused it
}

export interface OperationPlan {
  module: string;
  actions: PlannedAction[];
  blocked: BlockedAction[];
  totalReclaimableBytes: number | null;
  reversibility: Reversibility;
  irreversibilityReason?: string;   // REQUIRED when irreversibility === 'irreversible'
  requiresElevation: boolean;
}
```

Rails:

- **`reclaimableBytes` is `null`, never a guess.** An unknown size is reported as
  unknown. A number here is a measurement.
- **`irreversibilityReason` is required when irreversible.** The type makes it
  optional because the reversible case has no reason; a runtime check must reject an
  irreversible plan that omits it.
- **Blocked actions are reported, not silently dropped.** The user should see that
  something was skipped and why — silently omitting makes the tool look like it did
  less for no reason.
- **Planning must not mutate anything**, including creating the backup directory.
  A scan that writes is not a scan.

### 2. Confirm

The renderer shows the plan: what will change, how much it reclaims, **whether it can
be undone**, and where the backup will be. The user confirms.

Rails:

- Irreversible operations require an explicit acknowledgement in the UI. Not a
  different-coloured button — a distinct confirmation.
- The confirm step must show `blocked` entries too.

### 3. Execute

```ts
export interface ExecuteResult {
  success: boolean;              // true only when completed === actions.length
  completed: number;
  failed: number;
  skipped: number;
  reclaimableBytes: number | null;
  failures: { target: string; error: string }[];
  backupPath?: string;
  message?: string;
}
```

Rails:

- **Backup before the first destructive call, and abort if it fails.** No backup on
  disk means no operation. This is the rule Phase 2 established and it is not
  negotiable.
- **Elevation is checked before anything is touched.** Refuse up front rather than
  half-completing.
- **Fail closed.** If the framework cannot determine whether an action is permitted,
  it is refused.

### 4. Verify

Re-reads and confirms the intended end state. Success is reported only when the
verification confirms it.

Rails:

- A write or delete that silently did nothing must never report success. This is the
  failure mode of the removed fake registry backup and of the current `WIPE_FREE_SPACE`
  handler, which reports wiping 10 GB it never touched.
- Where verification is not possible for a given action kind, the framework says so in
  the result rather than implying it was verified.

### 5. Record

One activity-log entry per operation, including the backup path when one exists.

Rails:

- **Log only confirmed outcomes.** The log is a record of what happened, not what was
  attempted.
- Partial results are logged as partial.

---

## The protected list

Enforced by the framework, before any module is consulted. A module cannot opt out.

Unconditionally refused:

| Path | Reason |
|---|---|
| `%SystemRoot%` (`C:\Windows`) | except the specific safe subpaths listed below |
| `%ProgramFiles%`, `%ProgramFiles(x86)%` | installed applications |
| `%ProgramData%` | except the specific safe subpaths listed below |
| `%SystemDrive%\System Volume Information` | restore points and shadow copies |
| `%SystemDrive%\$Recycle.Bin` internals | the shell owns this structure |
| `%SystemRoot%\Installer` | deleting breaks uninstall, repair and update |
| `%SystemRoot%\WinSxS` | DISM only; direct deletion destroys the install |
| `pagefile.sys`, `hiberfil.sys`, `swapfile.sys` | kernel-managed; supported routes only |
| Boot files (`bootmgr`, `BCD`, `EFI` partition) | |
| User documents: `Documents`, `Desktop`, `Pictures`, `Videos`, `Music` | user data |
| DeskKlean's own backup directory | destroying the undo |
| The running application's own files | |

**Safe subpaths** — the only places under `%SystemRoot%` and `%ProgramData%` a module
may target, and only for the named purpose:

- `%SystemRoot%\Temp`
- `%SystemRoot%\Logs` (CBS/DISM log files)
- `%SystemRoot%\Panther` (upgrade logs)
- `%SystemRoot%\Minidump`, `%SystemRoot%\MEMORY.DMP`
- `%SystemRoot%\ServiceProfiles\NetworkService\AppData\Local\Microsoft\Windows\DeliveryOptimization\Cache`
- `%ProgramData%\Microsoft\Windows\WER\ReportQueue` and `ReportArchive`

Plus two structural rules:

- **Any path reached through a reparse point** (symlink or junction) that resolves
  outside the declared scan root is refused. Following them causes loops and lets a
  scan escape its own scope.
- **Every path must be absolute and resolved** (`fs.realpath`) before comparison.
  Comparison happens on the resolved path, never the input string.

Adding entries to this list is cheap. Removing one requires a decision recorded in
this document.

---

## The backup store

One location, one listing, one restore path — generalising what Phase 2 built for
Startup:

```
<userData>/backups/<module>/<ISO8601>-<slug>.reg      registry operations
<userData>/backups/<module>/<ISO8601>-<slug>.json     file-operation manifests
```

Rails:

- **Every backup carries a metadata header**, because filenames are lossy — the same
  trap as `StartupItem.id`, whose slug cannot be reversed. For `.reg` files the header
  is a `;` comment block, which `reg import` ignores and the existing backup listing
  already parses. For `.json` manifests the metadata is the document itself.
- **File deletions are backed up as a manifest, not as copies.** A manifest records
  the exact paths and metadata so the operation is enumerable and reportable; it is
  **not** a restore. Where a file cannot be restored, the plan must say
  `irreversible` rather than implying a manifest makes it undoable.
- **Deleting to the Recycle Bin is the reversible path for user data** (decision
  D-R2-4). A manifest records it; the shell holds the bytes.
- **The store is enumerable and restorable from the UI**, or it is not a safety
  mechanism — it is a file nobody reads.

---

### Migration note — existing backups

The Startup Optimizer phase currently writes its backups to `<userData>/registry_backups/`. The unified store relocates them to `<userData>/backups/startup/`. On first run after this change the app must:

1. Detect an existing `registry_backups` directory.
2. **Move** its contents to `backups/startup/`, preserving filenames (they already embed the item id and a timestamp).
3. Record the move in the activity log.
4. Only remove the source directory after the move succeeds.

If the move fails, leave the source in place and keep writing to it. A backup store that silently stops backing up is exactly the failure mode this project has already hit once — it must never recur.

## Path validation

Applied to every target before it reaches the protected list:

1. Must be a string, non-empty, absolute.
2. Must resolve via `fs.realpath` without throwing.
3. Must not contain a null byte.
4. Must not be a reparse point, and must not have been reached *through* one that
   escapes the scan root.
5. Must be inside the scope the plan declared.
6. Must not match the protected list.
7. Must not be a parent of a protected path — deleting `C:\Windows\Temp\..` must be
   refused as firmly as `C:\Windows`.

Rule 7 matters: validation that only checks the literal string is defeated by
traversal in the path itself.

---

## Partial failure

Reported as partial, always.

- `success` is `true` only when every action completed.
- A run that removed 40 of 50 files reports `completed: 40, failed: 10`, lists the
  failures, and returns `success: false`.
- The UI must not round a partial result up to a success, and must not show a
  reclaimed total that includes the failed items.

---

## Contract changes

New IPC channels:

| Channel | Purpose |
|---|---|
| `FRAMEWORK_PLAN` | module id + options → `OperationPlan`, changes nothing |
| `FRAMEWORK_EXECUTE` | plan id → `ExecuteResult` |
| `FRAMEWORK_BACKUPS_LIST` | list backups for a module |
| `FRAMEWORK_BACKUP_RESTORE` | restore one backup |

Existing per-module destructive handlers (`SMART_CLEAN_EXECUTE`,
`DUPLICATES_DELETE`, `SHRED_ITEMS`, `WIPE_FREE_SPACE`, `APPS_UNINSTALL`,
`REGISTRY_FIX`) are rewritten to call the framework rather than performing their own
work. `EXTENSIONS_TOGGLE` and `EXTENSIONS_REMOVE` are deleted (decision D-R2-7).

---

## Files

```
src/main/system/framework/
  plan.ts        plan types, validation, the protected list
  execute.ts     execute + verify + record
  backup.ts      the shared backup store, metadata headers, listing, restore
  protected.ts   the protected list and safe-subpath allowlist
src/main/ipc.ts  the four new channels; existing destructive handlers rewired
src/shared/types.ts  the plan/execute types crossing IPC
scripts/test-framework.mjs  pure-logic tests
```

---

## Implementation order

1. `protected.ts` + path validation, with tests — **no writes**
2. `plan.ts` types and the plan IPC channel
3. `backup.ts` — the store, metadata headers, listing, restore
4. `execute.ts` — backup, execute, verify, record
5. Rewire the existing destructive handlers onto it, one at a time

Steps 1–3 are read-only or non-destructive and can land before any module uses them.

---

## Verification

Pure logic, runs on the build machine, required before the phase is done:

- Path validation: absolute/relative, traversal, null byte, symlink escape, parent-of-protected
- Protected list: exact match, subpath match, case-insensitivity, `..` traversal attempts
- Reversibility: an irreversible plan without a reason is rejected
- Plan serialisation round-trips across IPC without losing `null` vs `0`
- Partial-failure arithmetic: `success` false unless `completed === actions.length`
- Backup metadata header is parseable back to the exact target

Windows acceptance, run by the owner:

1. Plan a harmless delete → confirm nothing on disk changed
2. Execute it → confirm the file is gone and a backup exists
3. Restore → confirm the file is back
4. Attempt to plan a delete inside `C:\Windows` → confirm it is refused with a reason

---

## Risks

| Risk | Mitigation |
|---|---|
| A module bypasses the framework | The framework owns the destructive primitives; modules get no filesystem delete of their own |
| Protected-list bypass via `..` or a symlink | Resolve first, then compare; refuse reparse points; refuse parents of protected paths |
| Backup written but not restorable | A manifest is not a restore. Declare `irreversible` where it is true |
| A restore silently fails | Verify the restore by re-reading, exactly as a write is verified |
| Partial success reported as success | `success` requires `completed === actions.length`; arithmetic is unit-tested |
| The framework itself becomes the single point of failure | It is the one place to get right, and it is tested — which is the point |
