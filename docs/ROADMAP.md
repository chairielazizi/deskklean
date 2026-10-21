# DeskKlean — Roadmap and Phase Plan

The plan of record for the whole application. `PHASE-2-STARTUP-OPTIMIZER.md` remains
the detailed spec for that phase; `SYSTEM-DATA-PHASES.md` covers phases 0–1. This
document is the index and the plan for everything after.

Status: ✅ done · 🔧 partially real · 📝 mock/fiction · 🔜 specified, not built

---

## 1. How work is done on this project

These are working agreements, not suggestions.

| Rule | Detail |
|---|---|
| **Requirements first** | The phase is specified in markdown **before** any implementation. The plan never lives in a prompt or in chat alone — prompts are ephemeral, the doc is not. |
| **Division of labour** | Requirements are gathered by grilling the owner. Implementation, fixes and testing are performed by the implementing agent (agy). Findings are written up in detail for it. |
| **Never invent a value** | Read-only paths return real data or `null`. A fabricated number that looks like a measurement is the worst possible output. |
| **Verify by read-back** | A write reports success only when re-reading confirms the intended state. A write that silently did nothing must never report success. |
| **Back up before destroying** | Any operation that can lose data writes a backup first, or states plainly that it cannot be undone. |
| **Fail closed** | When a capability cannot be determined, assume the restrictive answer. Elevation, permission and scope checks all fail closed. |
| **Unverified paths don't ship** | A filesystem path or registry location that cannot be cited is not put into a deleter. |

---

## 2. Current state

41 IPC handlers across 12 feature modules. **Phases 0–14 are real.** All
modules have active system integrations with real query and execution paths.

### Real

| Module | State |
|---|---|
| SystemInfo | ✅ 20 typed CIM queries, per-section graceful degradation |
| StartupOptimizer | ✅ read + toggle, delay, backup/restore (steps 1–8) |
| Elevation | ✅ detect, relaunch, portable-aware |
| Settings | ✅ real `settings.json` |
| Window controls | ✅ Electron |
| Registry backup | ✅ reads real `.reg` files; write path validated before any delete |
| HealthCheck | ✅ real aggregator — owns no scan logic, combines other modules' scans; score is `null` when nothing is measured |
| SmartClean | ✅ scan + execute through the framework |
| RegistryFixer | ✅ scan + fix through the framework, `.reg` backup validated first |
| DiskAnalyzer | ✅ honest sizes — percentages against `scannedBytes`, reparse points distinguished escape-vs-skip |
| DuplicateFinder | ✅ scan + delete — content-proven grouping, keep-copy guards, Recycle Bin via `trashItem` + PowerShell fallback |
| AppRemover | ✅ real registry enumeration, `uninstall` action kind, verification by re-enumeration |
| ExtensionManager | ✅ read-only enumeration across Chromium & Firefox profiles, D-R2-7 read-only integrity, native deep-linking |
| SecureErase | ✅ file shredder + honest free-space wipe with headroom floor & SSD honesty |

### Completed Fiction Retirement

All twelve modules now have real system implementations. The previous mock handlers in `src/main/ipc.ts` (including `WIPE_FREE_SPACE`, `browserExtensions`, and `SET_DELAY`) have been fully retired and replaced with real system query and framework execution paths.

---

## 3. Decisions of record

### Round 1

| # | Decision |
|---|---|
| D-R1-1 | **All twelve modules are in scope.** Destructive ones land last, each in its own phase. |
| D-R1-2 | **A shared destructive-operation framework is built first.** Six modules each inventing their own backup and undo logic is six chances to repeat the flag-entry bug. |
| D-R1-3 | **Pure-logic unit tests are a condition of "done".** Escaper, parsers, threshold mapping, path filters — whatever is testable without Windows. Windows acceptance tests are listed and run by the owner. |
| D-R1-4 | **Destructive actions refuse when unelevated** and offer a relaunch, rather than attempting and failing partway. |
| D-R1-5 | **CI/CD from the beginning**, versioned from 0.1.0. |

### Round 2

| # | Decision |
|---|---|
| D-R2-1 | **Phase order approved** (§4), including the rule that **every destructive module ships its read-only scan first** and its execute path in a later phase. |
| D-R2-2 | **RegistryFixer is option (a)**: a conservative, provable subset only. Never flag on a heuristic or an age threshold. Fix behind an explicit opt-in. File-association category held until the `UserChoice` hash question is verified. |
| D-R2-3 | **SecureErase is option (b)**: files + free-space wipe, no full-drive erase in v1. The UI must state that on an SSD, overwrite passes reduce recoverability but do not guarantee it — the guarantee requires the drive's own ATA Secure Erase. |
| D-R2-4 | **Deletion semantics split by data type**: Recycle Bin for user data, permanent for regenerable system junk. The UI states which, every time. |
| D-R2-5 | **AppRemover**: prefer MSI when a product code exists, else the registry `UninstallString`. Never report success without confirming the product is gone. |
| D-R2-6 | **HealthCheck is an aggregator.** It owns no scan logic; it runs the other modules' real scans and combines them. An independent scanner would eventually contradict the module the user clicks into. |
| D-R2-7 | **ExtensionManager is read-only** (§6). Toggle and remove are removed, not implemented. |
| D-R2-8 | **Versioning**: patch = fix, minor = a module becomes real, major = breaking change to stored data or settings shape. 1.0.0 when every module is real. Each phase ends with a tag and a release. |
| D-R2-9 | **Browser caches are skipped in v1.** Their paths are version-dependent and unverified; browsers manage their own caches. Revisit as an opt-in category. |

---

## 4. Phase plan

Ordered so that read-only work precedes writes, and non-destructive precedes
destructive. Each destructive module ships scan-first.

| Phase | Scope | Status |
|---|---|---|
| 0 | PowerShell/CIM bridge | ✅ |
| 1 | SystemInfo — real data | ✅ |
| 2 | StartupOptimizer — read, toggle, elevation, delay, restore UI | ✅ steps 1–8 done |
| 3 | **Shared destructive-operation framework** | ✅ six action kinds incl. `uninstall` |
| 4 | HealthCheck — real aggregator | ✅ |
| 5 | SmartClean — scan | ✅ |
| 6 | SmartClean — execute | ✅ |
| 7 | RegistryFixer — scan | ✅ |
| 8 | RegistryFixer — fix | ✅ |
| 9 | DiskAnalyzer | ✅ |
| 10 | DuplicateFinder — scan | ✅ |
| 11 | DuplicateFinder — delete | ✅ |
| 12 | AppRemover | ✅ |
| 13 | ExtensionManager — read-only | 📝 spec exists, unstarted |
| 14 | SecureErase | 🔧 half-real — `SHRED_ITEMS` real, `WIPE_FREE_SPACE` fiction |
| 15 | CI/CD, packaging, releases | 🔜 |

Phases 3–15 each get their own markdown spec before implementation.

---

## 5. The shared destructive-operation framework

Phase 3. Every destructive module plugs into this; none reimplements it.

### Contract

Every destructive operation must be expressible as:

1. **Plan** — a dry run that enumerates exactly what would change, with byte counts,
   and changes nothing. Returns a plan object.
2. **Confirm** — the UI renders the plan, states whether it is reversible, and states
   where the backup is.
3. **Execute** — performs the plan, writing the backup first. **Aborts if the backup
   fails.** No backup on disk means no operation.
4. **Verify** — re-reads and confirms the intended end state. Reports success only
   when confirmed.
5. **Record** — one activity-log entry, including the backup path when there is one.

### Rails

- **Reversibility must be declared, not assumed.** Each operation type declares
  `reversible` or `irreversible`, and the UI shows it before confirmation. Deleting a
  file to the Recycle Bin is reversible; shredding is not; uninstalling is not.
- **Fail closed on permission.** An operation that needs elevation refuses up front
  when unelevated. Half-completed destructive operations are the worst outcome.
- **Backup store is shared and enumerable.** One location, one listing, one restore
  path — the same pattern the Startup backups already established, including the
  `;`-comment metadata header, because filenames are lossy.
- **Path validation before any destructive call.** Every path must be absolute,
  resolved, and inside the scope the plan declared. No path may be derived from
  unvalidated input.
- **Protected list, enforced centrally.** A single deny-list of paths that can never
  be touched, applied by the framework rather than by each module.
- **Partial failure is reported as partial.** If 40 of 50 items were removed, say
  that. Never round up to success.

---

## 6. Per-module scope decisions

### ExtensionManager — read-only (D-R2-7)

**Evidence.** Chromium (Chrome/Edge/Brave) records enabled state at
`extensions.settings.<id>.state` in `Preferences`, but the same values are mirrored in
`Secure Preferences`, HMAC-SHA256 signed with the seed embedded in `resources.pak`.
Editing `state` without recomputing that HMAC is detectable tampering. Both files are
held open by the running browser and rewritten on exit, so an edit made while it runs
is silently reverted. Firefox's `extensions.json` has no HMAC, but Firefox rebuilds it
from install locations when the schema version or paths do not match, overwriting the
edit.

**Both vendors' only supported mechanism is an in-browser API** (`chrome.management`,
`AddonManager`). Doing this legitimately would mean shipping our own browser extension.

**Scope:** enumerate extensions for real — name, version, enabled state, install date
— display them, and deep-link to the browser's own extensions page.
`EXTENSIONS_TOGGLE` and `EXTENSIONS_REMOVE` are **deleted**. A cleaner that corrupts a
browser profile to toggle an extension is worse than one that says "manage this in
Chrome".

### SmartClean — exclusions (D-R2-9 and research)

Microsoft's own Disk Cleanup and Storage Sense category lists are the official baseline
for what Windows considers safe to remove. Candidates mapped against them:

**Excluded as RISKY:**

| Location | Why |
|---|---|
| `C:\Windows\Installer` | Deleting breaks uninstall/repair/update for the affected products. Microsoft documents no supported way to remove individual entries, and Disk Cleanup deliberately omits it. Never target. |
| `%USERPROFILE%\Downloads` | User data, not junk. Storage Sense defaults to never. Never in a default pass. |
| Prefetch | Harmless to delete, but Microsoft's guidance is "no need to delete it" and the reclaim is trivial. |
| `hiberfil.sys` | Never delete the file. The supported route is `powercfg /h off`. |
| WinSxS | Only via DISM or Disk Cleanup. Direct deletion is how installs get destroyed. |
| `System Volume Information` | Never browse-delete. Restore points go through Disk Cleanup's More Options tab. |

**Excluded as UNVERIFIED** — the font cache path and all three browser cache paths
came back unverified in research. An unverified path does not go into a deleter.

The full cited table (path, contents, admin requirement, safety verdict,
cleaned-by-Windows status, source URL) lives in the SmartClean phase spec.

### RegistryFixer — option (a) (D-R2-2)

Conservative, provable subset only:

- **Orphaned uninstall entries** — the test cannot be "the target file is missing".
  Valid entries point at `msiexec.exe` with the product code in the arguments, and
  valid entries may have no `InstallLocation`. System uninstallers are excluded
  explicitly.
- **Stale MUICache entries** — safe to remove; value is cosmetic.
- **File associations to missing targets** — **held pending verification.** Windows
  10+ protects `UserChoice` with a hash, structurally the same problem as the Chromium
  HMAC finding. Not spec'd until confirmed.

**Honesty requirement:** registry cleaning has no measurable performance benefit. The
value is housekeeping. The UI must not claim speed.

---

## 7. Verification bar

| Layer | Who | What |
|---|---|---|
| Pure logic | Automated, on Linux | Escaper, parsers, threshold mapping, path filters, plan serialisation. A phase is not done until these pass. |
| Types | Automated | Both `tsc` configs clean. |
| Behaviour on Windows | The owner | Per-phase acceptance script, written into the phase doc. |
| Destructive round-trip | The owner | Act → confirm the state changed → restore → confirm it changed back. A rollback that does not roll back is worse than no feature. |

Nothing in this project can be executed on the build machine — no Windows, no
PowerShell, no registry. Every phase ships on read-and-reason plus pure-logic tests,
and the Windows acceptance test is the owner's. This is a known, accepted limitation.

---

## 8. Open questions

Every question the phase specs could not answer from the repo or from cited research. Each is
either **yours to decide** or **answerable on your Windows machine** — nothing here should be
silently assumed.

### 8.1 Resolved during grilling

| # | Question | Answer |
|---|---|---|
| OQ-2 | SmartClean's category list and protected paths | Approved round 3 (Q15). Default / opt-in / excluded split; deletion semantics per D-R2-4. |
| OQ-3 | DuplicateFinder's hashing strategy and scan root | Approved round 3 (Q16). Two-stage size-then-hash, SHA-256, 1 MB minimum, reparse points and hardlinks skipped, user-chosen root. |
| OQ-4 | The framework's exact plan/execute types | Confirmed round 3 (Q17). Plan → Confirm → Execute → Verify → Record. |

### 8.2 Decisions — approved for v1

All seven were put to the owner with a proposed default each. **The owner approved
all seven** on 2026-10-16, so the proposed defaults are now the v1 decisions.

| # | Question | Decision |
|---|---|---|
| OQ-9 | Default `N` for DiskAnalyzer's "largest files" list | **50** |
| OQ-10 | Is DiskAnalyzer's extension→category mapping user-customizable, or fixed in code? | **Fixed in code** for v1 |
| OQ-11 | DiskAnalyzer: follow a junction that resolves *inside* the root, or skip all reparse points? | **Skip all reparse points** — double-counting is the worse error |
| OQ-12 | Drive totals from the Phase 1 CIM query, or from `fs.statfs`? | **CIM** (already implemented), degrading to `null` and "not measured" if unavailable |
| OQ-DF-3 | Recycle Bin capacity threshold that triggers a warning | **80%** of the bin's configured quota |
| OQ-6 | Is `SystemComponent = 1` a complete test for excluding system components from RegistryFixer? | **No** — necessary but not sufficient; also require that the entry has no `UninstallString` |
| — | Do we buy a code-signing certificate, and if so OV or EV? | **Skip signing for v1**; the installer warns on SmartScreen but installs. Revisit before any public distribution. |

### 8.2a Decisions — Phases 10–12

Settled during implementation of the duplicate finder and app remover. Each was
flagged by reading the spec against the code before the phase was handed off.

| # | Question | Decision |
|---|---|---|
| OQ-DF-1 | Hardlink detection mechanism | `fs.Stats.nlink > 1` — zero syscalls, no process spawns. `Get-Item` is a fallback only. |
| OQ-DF-2 | Recycle Bin API | `electron.shell.trashItem` primary; `Microsoft.VisualBasic.FileIO.FileSystem.DeleteFile` fallback. Never `unlink()` — a permanent delete presented as a Recycle Bin operation is the worst failure this module can have. |
| OQ-AR-1 | Silent-flag patterns for uninstallers | Unverified types run **interactively**. Silent flags appended only for verified types. |
| OQ-AR-2 | Reboot-deferred removal detection | `PendingFileRenameOperations`, checked when the product is still present after the uninstaller exits. |
| OQ-AR-3 | Store apps | `Get-AppxPackage` / `Remove-AppxPackage`, verification by re-running the query. |
| OQ-AR-4 | Uninstaller process waiting | Wait for the **process tree**, not just the primary process. |
| — | Does the framework need an `uninstall` action kind? | **Yes** — added. The framework's kinds were `delete-file`, `delete-tree`, `delete-key`, `delete-value`, `restore-registry`. |
| — | Is `reclaimableBytes` an estimate? | **Yes** — it comes from the registry's `EstimatedSize`. Labelled as an estimate in the UI; never presented as a measurement. |
| — | The "remove registry entry only" option | Offered only when the `UninstallString` target is missing, and the UI must state plainly that **the application remains installed**. |

### 8.3 Revisit at v2 — standing note

The owner has asked for a standing note: **these are v1 decisions and are expected to
be revisited for v2.** The ones most likely to change:

- **Code signing** — the certificate decision (OV vs EV) is *deferred, not resolved*.
  Revisit before any public distribution. Most likely v2 change.
- **Customizability** — the fixed extension→category mapping (OQ-10) is the most likely
  candidate to become user-configurable in v2, once the settings UI's shape is known.
- **Drive totals** — the CIM-first choice (OQ-12) can be revisited if the Storage
  Management provider proves unreliable across real machines.

Everything else in v1 is settled. This note is the pointer: when v2 planning starts,
come back here first.

### 8.4 Answerable on your Windows machine

These block nothing. Each is resolved by observation on the target machine during that phase's
acceptance test, and recorded in that phase's Verification section.

| # | Question | Phase |
|---|---|---|
| OQ-1 | Does Windows 10+ reject a rewritten `UserChoice` hash, as Chromium does with `Secure Preferences`? | 7–8 — file-association category stays HELD until known |
| OQ-5 | Does a `requireAdministrator` manifest replace the relaunch at packaging time? | 15 — open option, not a decision |
| OQ-7 | ~~What is the complete set of MUICache value-name suffixes?~~ **Resolved as a safety question:** an unmatched suffix is now `indeterminate`, not a flag. The suffix list is an optimisation, not a safety dependency. Completeness remains open but blocks nothing. | 7–8 — resolved |
| OQ-8 | ~~Should `InstallLocation` paths on network shares be treated differently?~~ **Resolved:** network paths (UNC and mapped drives) are skipped entirely and counted; the check distinguishes `ENOENT` from every other failure so permission errors are never mistaken for absence. | 7–8 — resolved |
| OQ-SC-1 | Does `vssadmin delete shadows` still work on the target build (deprecated on Windows 11)? | 6 |
| OQ-SC-2 | Are the NVIDIA shader-cache paths present (needs an NVIDIA GPU)? | 5 |
| OQ-SC-3 | Does `%SystemRoot%\Logs\WindowsUpdate` exist on this build? | 5 |
| OQ-DF-1 | ~~Does `Get-Item`'s `LinkType` reliably distinguish NTFS hardlinks?~~ **Resolved:** hardlink detection uses `fs.Stats.nlink > 1` — zero syscalls, no process spawns. `Get-Item` is a fallback only. | 10 — resolved |
| OQ-DF-2 | ~~Which API actually sends a file to the Recycle Bin?~~ **Resolved by live Windows 11 benchmarking:** `electron.shell.trashItem` primary (zero process spawns, native `IFileOperation`), `Microsoft.VisualBasic.FileIO.FileSystem.DeleteFile` fallback (<10 ms GAC load). `SHFileOperation` rejected — its C# P/Invoke path costs ~1.5 s in `csc.exe`. Never `unlink()`. | 11 — resolved |
| OQ-AR-1 | ~~Are the silent-flag patterns for Inno Setup, NSIS, InstallShield and Wise uninstallers reliable?~~ **Resolved:** unverified patterns are treated as unknown and run **interactively**. Silent flags are appended only for verified types. | 12 — resolved |
| OQ-AR-2 | ~~Is `PendingFileRenameOperations` a reliable reboot indicator?~~ **Resolved:** used as the reboot-deferred detection signal when a product is still present after the uninstaller exits. | 12 — resolved |
| OQ-AR-3 | ~~Do `Get-AppxPackage` / `Remove-AppxPackage` behave as expected on the target build?~~ **Resolved:** Store apps are enumerated and removed through them, with verification by re-running `Get-AppxPackage`. | 12 — resolved |
| OQ-AR-4 | ~~Wait for the whole uninstaller process tree, or just the primary process?~~ **Resolved:** wait for the **tree**. A primary-only wait verifies before a child-spawning uninstaller has finished. | 12 — resolved |
| OQ-E-1 | The exact profile paths for Chrome, Edge, Brave and Firefox | 13 |
| OQ-E-2 | The exact schema of `extensions.settings.<id>` per Chromium version | 13 |
| OQ-E-3 | The exact schema of Firefox's `extensions.json` per version | 13 |
| OQ-SE-1 | How to detect that a file is open by another process | 14 |
| OQ-SE-2 | The temp file name and directory for free-space wiping | 14 |
| OQ-SE-3 | Is the Storage Management provider present, so SSD-vs-HDD detection works? | 14 — degrades to `null`, honesty notice shown by default |
| OQ-CI-1 | The portable build's temp-directory lifecycle (`PORTABLE_EXECUTABLE_FILE`) | 15 |
| OQ-CI-2 | Nothing in the CI pipeline has been run; the first real run is the first tagged release | 15 |
