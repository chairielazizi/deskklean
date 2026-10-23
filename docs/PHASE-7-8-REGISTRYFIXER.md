# Phases 7-8 — RegistryFixer

**Status:** ✅ implemented and verified (Phase 7 scan & Phase 8 fix complete; 148/148 tests pass)
**Depends on:** Phase 3 (shared destructive-operation framework) ✅ · Phase 2 (registry read/write, `.reg` escaper, backup format) ✅

---

## Goal

Replace the hardcoded `sampleRegistryIssues` array in `REGISTRY_SCAN` with a real
read-only scan that flags registry entries **only when it can be proven** that the
referenced target no longer exists. Phase 7 lands the scan. Phase 8 lands the fix,
behind an explicit opt-in, with a `.reg` backup before every write.

---

## Why this phase is different

RegistryFixer is the highest-risk module in the project. A wrong registry delete
can break an installed application, a file association, or a Windows component.
Decision D-R2-2 answered this with option (a): a conservative, provable subset only.

The hard rule, stated once and binding everywhere:

> **Flag an entry ONLY when it can be proven that the referenced target no longer
> exists. Never on a heuristic. Never on an age threshold. If it cannot be proven,
> it is not listed.**

This means the scan returns fewer entries than a heuristic-based cleaner would.
That is the point. A conservative list that is mostly right is more useful than an
aggressive list that is sometimes wrong.

---

## Scope

### In scope

| Category | What it is | Why it is safe |
|---|---|---|
| Orphaned uninstall entries | Subkeys under the three Uninstall keys whose `InstallLocation` directory no longer exists on disk | The directory is provably gone; the entry is dead weight in the registry |
| Stale MUICache entries | Values under `MuiCache` whose referenced executable file no longer exists | The file is provably gone; the cached display string is dead weight |

### Held — out of scope until resolved

| Category | What it is | Why it is held |
|---|---|---|
| File associations to missing targets | `UserChoice` / `OpenWithProgids` under `FileExts` whose ProgID handler executable is missing | Windows 10+ protects `UserChoice` with a hash, structurally the same problem as the Chromium `Secure Preferences` HMAC finding (OQ-1 in the roadmap). Rewriting it without recomputing the hash is detectable tampering, and the edit may be silently rejected or reverted. Not spec'd until confirmed. |

### Explicitly excluded

- **Entries whose uninstall mechanism is `msiexec.exe` or `rundll32.exe`.** These
  are valid: the target is the product code in the Windows Installer database, not
  a file on disk. The absence of a file path does not prove the product code is
  invalid. Even if the `InstallLocation` directory is gone, the MSI entry itself
  may still be needed for repair or update operations.
- **Entries with no `InstallLocation` value at all.** No install directory means
  there is nothing to prove missing. Many valid entries (MSI entries, system
  components, per-user registrations) have no `InstallLocation`.
- **System components.** Entries that are OS components are excluded explicitly.
  The exact identification mechanism (e.g. a `SystemComponent` DWORD value, or
  parented under a known system product code) needs verification on Windows —
  **UNVERIFIED**. Until confirmed, the safest approach is to skip any entry
  whose `UninstallString` or `DisplayName` contains a Microsoft Corporation
  publisher marker, but this heuristic itself needs validation.

---

## Honesty requirements

Registry cleaning has **no measurable performance benefit**. The value is
housekeeping — removing dead entries so the registry is smaller and easier to
navigate. The UI must not claim speed. Specifically:

- The scan result is a list of provably dead entries, not a health score.
- There is no "issues found" counter that implies the system is unhealthy.
- The fix button says "Remove dead entries" — not "Fix", "Clean", or "Optimize".
- The module header states: "Registry cleaning does not improve system speed."
- No entry count is presented as a severity metric. Both in-scope categories are
  severity `low` by definition: they are dead weight, not active problems.

---

## Phase 7 — Scan (read-only)

### Enumeration

#### The three-outcome filesystem check

Every existence check in this module returns one of **three** outcomes, not a
boolean:

| Outcome | Meaning | Flagged? |
|---|---|---|
| `exists` | The path was resolved and the target is there | No |
| `gone` | The path was resolved and the target is provably absent (`ENOENT`) | **Yes — the only flag** |
| `indeterminate` | The check could not complete — permission denied (`EACCES`/`EPERM`), I/O error (`EIO`), device unavailable, network timeout, or any other non-`ENOENT` failure | No |

`fs.existsSync` is **not** usable for this. It collapses "provably absent" and
"could not be checked" into the same `false`, which would flag a locked-down
directory as dead weight. The check must be written against the error code:
`ENOENT` means gone; anything else means indeterminate.

Rails:

- **`indeterminate` is never a flag.** It is the absence of proof, and the
  binding rule requires proof. An entry that cannot be checked is not listed.
- **Indeterminate entries are counted, not hidden.** The scan result carries an
  `indeterminateCount` so the user knows the scan was incomplete. Reporting
  "0 issues" when N entries could not be checked is a lie of omission.
- **The same rule applies to both in-scope categories.** Uninstall locations and
  MUICache file paths go through the identical check.

#### Network and UNC paths

Paths that live on a network — UNC paths (`\\server\share\...`) and mapped
network drives — are **skipped entirely**. They are neither flagged nor counted
as indeterminate.

Rationale: a network share that is temporarily unreachable is indistinguishable
from one that no longer exists, and a laptop that is simply off the corporate
network would produce a wall of false positives. **Reachability is not
provability.** Since the target cannot be proven gone, the entry is not listed.

This is a deliberate limitation, and the UI states it: network-backed entries are
not scanned. Skipped entries are counted in `skippedNetworkCount` so the omission
is visible rather than silent.

Detection of a network path:

- UNC: the path begins with `\\` (or `//`).
- Mapped drive: the drive letter has a `DRIVE_REMOTE` type. Resolve via
  `GetDriveType`-equivalent (a single CIM/`Win32_LogicalDisk` lookup per distinct
  drive letter, cached for the scan) — **not** by assuming every non-`C:` letter
  is remote, since a machine may have several local volumes.

#### Orphaned uninstall entries

The three standard Windows Uninstall keys:

```
HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall
HKLM\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall
HKCU\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall
```

For each subkey, read these values:

| Value | Purpose |
|---|---|
| `DisplayName` | Human-readable name for the UI |
| `InstallLocation` | Directory to check for existence |
| `UninstallString` | To detect MSI entries (references `msiexec.exe`) |
| `DisplayIcon` | To detect MSI entries (may reference `msiexec.exe` or `rundll32.exe`) |
| `SystemComponent` | To identify system components (UNVERIFIED — see scope above) |

Detection algorithm:

```
For each UninstallKey in [HKLM, HKLM\WOW6432Node, HKCU]:
  For each Subkey in UninstallKey:
    # Exclusion 1: system components
    If SystemComponent equals 1:
      Skip

    # Exclusion 2: Windows Installer entries
    If UninstallString or DisplayIcon references msiexec.exe or rundll32.exe:
      Skip  # target is product code, not a file path

    # Exclusion 3: no install location
    If InstallLocation is absent or empty:
      Skip  # nothing to prove missing

    # Exclusion 4: network paths
    If InstallLocation is a UNC path or a mapped network drive:
      Skip, increment skippedNetworkCount  # reachability is not provability

    # Detection — three outcomes, only one is a flag
    If InstallLocation is present and non-empty:
      outcome = checkPathOutcome(InstallLocation)
      If outcome is "gone":
        Flag as orphaned_uninstall
        Evidence: { checkedPath: InstallLocation, outcome: "gone" }
      If outcome is "indeterminate":
        Skip, increment indeterminateCount  # absence of proof is not proof of absence
      Else:
        Skip  # "exists"
```

Rails:

- **A missing `InstallLocation` is not a flag.** It is the absence of evidence,
  not evidence of absence. Valid entries may have no install directory.
- **An `msiexec.exe` reference is not a flag.** The product code in the arguments
  is the real target, and its validity cannot be proven or disproven by checking
  a file path.
- **A `rundll32.exe` reference is not a flag.** Same rationale: the target is a
  DLL function, not a file path that can be checked for existence.
- **A network path is not a flag.** Reachability is not provability — see
  "Network and UNC paths" above.
- **`indeterminate` is not a flag.** An entry that could not be checked is not
  listed. Absence of proof is not proof of absence.
- **Only a proven absence is a flag.** An entry is flagged when and only when
  `InstallLocation` is present, non-empty, non-network, checkable, and the check
  returns `gone`. No other signal is sufficient.

#### Stale MUICache entries

The MUICache key:

```
HKCU\Software\Classes\Local Settings\Software\Microsoft\Windows\Shell\MuiCache
```

Each value name is a file path with a suffix. Known suffixes include
`.ApplicationCompany` and `.ApplicationName` — the full set of suffixes needs
Windows verification (**UNVERIFIED**).

Detection algorithm:

```
For each Value in MuiCache:
  # Value name format: <filepath>.<suffix>
  valueName = the raw value name

  # STEP 1 — the value name may itself be a real path.
  # A genuine filename can end in a string that looks like a known suffix
  # (e.g. a file literally named "setup.ApplicationName"). If the whole value
  # name resolves, the entry is not stale and nothing needs stripping.
  If checkPathOutcome(valueName) is "exists":
    Skip  # not stale

  # STEP 2 — strip a known suffix. If NONE matched, we cannot tell where the
  # path ends, so we cannot prove anything is gone. This is the critical step:
  # an unmatched suffix must NOT fall through to the existence check.
  (filepath, suffixMatched) = stripKnownSuffix(valueName)
  If suffixMatched is false:
    Skip, increment indeterminateCount  # NOT a flag — see the rails below

  # STEP 3 — only a proven absence is a flag
  Else:
    If filepath is a UNC path or a mapped network drive:
      Skip, increment skippedNetworkCount
    outcome = checkPathOutcome(filepath)
    If outcome is "gone":
      Flag as stale_mui_cache
      Evidence: { checkedPath: filepath, outcome: "gone" }
    If outcome is "indeterminate":
      Skip, increment indeterminateCount
    Else:
      Skip  # "exists"
```

Rails:

- **A MUICache entry is stale only when the referenced file is provably gone.**
  The file path is extracted from the value name; if that file is provably
  absent, the cached display string is dead weight. `indeterminate` does not
  qualify — see the three-outcome check above.
- **An unmatched suffix is NEVER a flag.** If no known suffix matches the value
  name, the path boundary is unknown and nothing can be proven. The entry is
  counted as `indeterminate` and skipped. Falling through to the existence check
  instead would test a filename that cannot exist and declare the entry dead.
  This is not hypothetical: it produced **318 false positives on a real Windows
  machine**, including `explorer.exe`, Steam, 7-Zip and DaVinci Resolve, because
  `.FriendlyAppName` was missing from the list.
- **The suffix list is an optimisation, not a safety dependency.** A missing
  suffix must degrade to "not checked", never to "flagged". That is what makes
  the module safe without the list being complete.
- **Network paths are skipped here too.** A file on an unreachable share cannot
  be proven gone, so it is not listed.
- **Multiple suffixes may reference the same file.** If `setup.exe.ApplicationCompany`
  and `setup.exe.ApplicationName` both exist and `setup.exe` is gone, both entries
  are flagged. The UI may group them under the same file path.

### Scan result

```ts
export type RegistryFixerIssueType = 'orphaned_uninstall' | 'stale_mui_cache';

export interface RegistryFixerIssue {
  id: string;
  type: RegistryFixerIssueType;
  hive: 'HKCU' | 'HKLM';
  keyPath: string;            // registry key path (without hive prefix)
  valueName?: string;         // for MUICache: the value name; for uninstall: undefined (whole key)
  displayName: string;        // human-readable name
  description: string;        // why it was flagged (the proof)
  severity: 'low';            // both categories are low-risk housekeeping
  selected: boolean;
  evidence: {
    checkedPath: string;      // the filesystem path that was checked
    outcome: 'gone';          // only "gone" is ever flagged — see the three-outcome check
  };
}

export type PathCheckOutcome = 'exists' | 'gone' | 'indeterminate';

export interface RegistryScanResult {
  issues: RegistryFixerIssue[];
  scannedAt: string;
  indeterminateCount: number;    // entries that could NOT be checked (EACCES, EIO, ...)
  skippedNetworkCount: number;   // entries skipped because their path is on a network
}
```

### What the scan does NOT do

- It does not flag entries based on age, last-access time, or any timestamp.
- It does not flag entries based on heuristics like "publisher is unknown" or
  "display name looks like a temporary file".
- It does not flag entries whose target file exists but is corrupted or outdated.
- It does not flag file associations (held — see scope above).
- It does not flag `SharedDLLs`, `App Paths`, `CLSID`, `TypeLib`, or any other
  registry location outside the two in-scope categories.
- It does not flag entries whose target could not be checked (`indeterminate`).
  It counts them, so the incompleteness is visible.
- It does not scan entries whose path is on a network. It counts them.

---

## Phase 8 — Fix (destructive, behind explicit opt-in)

### Opt-in model

- The scan always runs. It is read-only and requires no confirmation.
- The fix is behind an explicit opt-in: the user must select entries and click
  "Remove dead entries".
- The fix button is disabled until at least one entry is selected.
- Every fix writes a `.reg` backup before writing. There is no "skip backup"
  option.

### Framework integration

The fix path plugs into the Phase 3 shared destructive-operation framework. The
module supplies *what* to delete; the framework owns *how it is allowed to happen*.

#### 1. Plan

A dry run. For each selected issue, enumerate exactly what would change:

- `orphaned_uninstall`: delete the entire registry subkey (all values within it).
- `stale_mui_cache`: delete the specific registry value.

The plan declares:
- `reversibility: 'reversible'` — the `.reg` backup makes deletion undoable via
  `reg import`.
- `reclaimableBytes: null` — registry keys do not have a meaningful byte size on
  disk; this is housekeeping, not space reclamation. Never estimate.
- `requiresElevation: true` when any target is under `HKLM`.

Rails:

- **Planning must not mutate anything**, including creating the backup directory.
- **Blocked actions are reported, not silently dropped.** If the framework's
  protected list or path validation refuses a target, it appears in `blocked` with
  a reason.

#### 2. Confirm

The UI renders the plan: what will be deleted (key paths, value names), whether it
can be undone (it can, via `.reg` backup), and where the backup will be written.
The user confirms explicitly.

Rails:

- **Irreversible operations require an explicit acknowledgement.** Registry key
  deletion is reversible via the `.reg` backup, so it is not irreversible — but
  the UI must still show the backup path and confirm before proceeding.
- **The confirm step must show `blocked` entries too.**

#### 3. Execute

- **Backup before the first destructive call, and abort if it fails.** No backup
  on disk means no operation. This is the rule Phase 2 established and it is not
  negotiable.
- **Elevation is checked before anything is touched.** HKLM deletions require
  administrator rights. Refuse up front rather than half-completing.
- **Fail closed.** If the framework cannot determine whether an action is
  permitted, it is refused.

The `.reg` backup reuses the Phase 2 format exactly:

- `Windows Registry Editor Version 5.00` header.
- `;` comment metadata block recording the exact key paths, value names, hive,
  and timestamp (because filenames are lossy — the same lesson as
  `StartupItem.id`).
- `[HKEY_...]` section headers using the long form (`HKEY_CURRENT_USER` /
  `HKEY_LOCAL_MACHINE`).
- Value lines with proper escaping via the existing `buildRegSnippet` function.
- CRLF line endings.
- UTF-16LE with BOM (because `reg import` reads a BOM-less file as ANSI and
  would corrupt a non-ASCII name).
- Stored at `%APPDATA%\DeskKlean\backups\registry\` as
  `<ISO8601>-<slug>.reg`, alongside the existing registry-backup store.

For orphaned uninstall entries, the backup exports the entire subkey with all
its values. For stale MUICache entries, the backup exports just the specific
value.

#### 4. Verify

Re-reads the registry and confirms the intended end state:

- For `orphaned_uninstall`: confirm the subkey no longer exists.
- For `stale_mui_cache`: confirm the value no longer exists.

Rails:

- **A delete that silently did nothing must never report success.** This is the
  failure mode of the removed fake registry backup and of the current
  `WIPE_FREE_SPACE` handler.
- **Where verification is not possible**, the framework says so in the result
  rather than implying it was verified.

#### 5. Record

One activity-log entry per operation, including the backup path.

Rails:

- **Log only confirmed outcomes.** The log is a record of what happened, not what
  was attempted.
- **Partial results are logged as partial.** If 8 of 10 entries were deleted,
  say so. Never round up to success.

---

## Contract changes

| Change | Detail |
|---|---|
| `RegistryIssue` type | Replaced by `RegistryFixerIssue` — only `orphaned_uninstall` and `stale_mui_cache` types |
| `RegistryIssueType` | Replaced by `RegistryFixerIssueType` — the nine old types (`missing_dll`, `unused_extension`, etc.) are all out of scope |
| `REGISTRY_SCAN` return type | `RegistryScanResult` — `issues`, `scannedAt`, `indeterminateCount`, `skippedNetworkCount` — instead of a bare `RegistryIssue[]` |
| `REGISTRY_FIX` return type | `RegistryFixerResult` with `fixedCount`, `failedCount`, `backupPath`, `message` |
| `REGISTRY_FIX` behavior | No longer returns `{ success: false }` — performs the real fix via the Phase 3 framework |
| `createBackup` parameter | Removed from the UI contract — backup is always written, not optional |
| New `evidence` field | Every issue carries the proof: what path was checked and whether it exists |

The preload contract changes here — this is a breaking change for the renderer.

---

## Files

```
src/main/system/registry-fixer/
  scan-uninstall.ts    enumerate Uninstall keys, read values, check filesystem
  scan-mui-cache.ts    enumerate MUICache values, check filesystem
  fix.ts               plan, backup, delete, verify — via Phase 3 framework
src/main/ipc.ts         replace REGISTRY_SCAN and REGISTRY_FIX handlers
src/shared/types.ts     new RegistryFixerIssue, RegistryFixerIssueType, RegistryFixerResult
src/preload/index.ts    update scanRegistry and fixRegistryIssues signatures
src/renderer/.../RegistryFixer.tsx  update to real types, remove mock assumptions
scripts/test-registry-fixer.mjs     pure-logic tests for the detection algorithm
```

---

## Implementation order

Safety-first — the scan lands before the fix:

1. `scan-uninstall.ts` + `scan-mui-cache.ts` — read-only enumeration and detection,
   with tests. **No writes.**
2. `REGISTRY_SCAN` handler — returns real `RegistryFixerIssue[]`.
3. `fix.ts` — Phase 3 framework integration: plan, backup, execute, verify.
4. `REGISTRY_FIX` handler — performs the real fix.
5. Backup list + restore UI — reuse the existing `REGISTRY_GET_BACKUPS` and
   `REGISTRY_RESTORE_BACKUP` infrastructure from Phase 2.

Steps 1-2 are read-only and can land on their own. Step 4 is the first write and
must not be attempted before the Phase 3 framework works.

---

## Verification

Pure logic, runs on the build machine, required before the phase is done:

- Orphaned uninstall detection: MSI entries are skipped, entries with no
  `InstallLocation` are skipped, entries with a missing directory are flagged,
  entries with an existing directory are not flagged.
- Stale MUICache detection: entries with a missing file are flagged, entries with
  an existing file are not flagged.
- Suffix stripping: `.ApplicationCompany`, `.FriendlyAppName` and
  `.ApplicationName` are stripped correctly from value names.
- Unmatched suffix: a value name whose suffix is NOT in the known list produces
  ZERO flags and increments `indeterminateCount`. This is the regression test for
  the 318-false-positive incident; it must fail if the unmatched case ever falls
  through to the existence check.
- Whole-value-name path: a value name that resolves as a real path is not stale,
  even if it ends in a string that looks like a known suffix.
- Evidence field: every flagged issue carries the correct `checkedPath` and
  `outcome: 'gone'`.
- No heuristic flags: no entry is flagged based on age, publisher, or any signal
  other than the filesystem existence check.
- Three-outcome check: a path that resolves to `ENOENT` returns `gone`; a path
  that raises `EACCES`/`EPERM`/`EIO` returns `indeterminate`; an existing path
  returns `exists`. Only `gone` produces a flag.
- Network paths: a UNC path (`\\server\share\...`) and a path on a mapped
  network drive are skipped, counted in `skippedNetworkCount`, and never flagged.
- Indeterminate entries: counted in `indeterminateCount` and absent from
  `issues`. A scan where every check is indeterminate returns 0 issues and a
  non-zero count — never a bare "0 issues".

Windows acceptance, run by the owner:

1. Scan a real Windows machine — confirm the scan returns only provably dead
   entries, not heuristic guesses.
2. Verify that MSI-installed applications (which have `msiexec.exe` in their
   `UninstallString`) are NOT flagged, even if their `InstallLocation` is gone.
3. Verify that entries with no `InstallLocation` are NOT flagged.
4. Fix a selected entry — confirm the `.reg` backup is written, the registry
   entry is deleted, and the activity log records it.
5. Restore the backup — confirm the registry entry returns.

---

## Risks

| Risk | Mitigation |
|---|---|
| A valid entry is flagged because its `InstallLocation` is a network path or UNC path that is temporarily unavailable | **Resolved.** Network paths (UNC and mapped drives) are skipped entirely — neither flagged nor counted as indeterminate. Reachability is not provability. The skipped count is surfaced so the omission is visible. |
| A valid entry is flagged because its target exists but cannot be read (permission denied, I/O error) | **Resolved.** The check distinguishes `ENOENT` (gone) from every other failure (indeterminate). Only `gone` is flagged; indeterminate entries are counted, never listed. |
| `SystemComponent` identification is wrong | UNVERIFIED. The safest approach is to skip entries with `SystemComponent = 1`, but this value's exact semantics need Windows confirmation. Until verified, also skip entries whose publisher is Microsoft Corporation. |
| MUICache suffix set is incomplete | **Mitigated, and empirically shown to matter.** The known suffixes are `.ApplicationCompany`, `.FriendlyAppName` and `.ApplicationName`; the full set is still UNVERIFIED. The earlier interim rule ("only strip known suffixes") was **wrong** — it fails open, treating an unknown suffix as part of the path and flagging a live file. It produced 318 false positives on a real machine. The rule is now: an unmatched suffix yields `indeterminate`, never a flag. A missing suffix degrades to "not checked" rather than "flagged". |
| The `.reg` backup is written but not restorable | A `.reg` file is a backup, not a restore. The backup must be validated (header check, parseable) before the delete proceeds. The restore path reuses the Phase 2 infrastructure. |
| Partial success reported as success | `success` requires `completed === actions.length`; arithmetic is unit-tested. |
| The fix is attempted on an entry that was already removed by another process | The verify step re-reads the registry. If the entry is already gone, the fix reports it as "already absent" — not as a success or a failure, but as a no-op with an honest message. |
| HKLM fix attempted unelevated | The framework refuses up front. The user is offered the elevation relaunch. |

---

## Open questions

| # | Question | Blocks |
|---|---|---|
| OQ-1 (from roadmap) | Does Windows 10+ reject a rewritten `UserChoice` hash, as Chromium does with `Secure Preferences`? | The file-association category — held until resolved |
| OQ-6 | What is the exact identification mechanism for "system components" in Uninstall keys? Is `SystemComponent = 1` the correct and complete test? | The system-component exclusion |
| OQ-7 | What is the complete set of MUICache value name suffixes? Known so far: `.ApplicationCompany`, `.FriendlyAppName`, `.ApplicationName`. Still open as a **completeness** question — but no longer a **safety** question, because an unmatched suffix is now `indeterminate` rather than a flag. | Completeness of MUICache detection only. Does not block safety. |
| OQ-8 | ~~Should `InstallLocation` paths that are network shares (UNC paths) be checked differently?~~ **Resolved (v1 decision):** network paths (UNC and mapped drives) are skipped entirely and counted; the check distinguishes `ENOENT` from every other failure so permission errors are never mistaken for absence. | Nothing — resolved |
