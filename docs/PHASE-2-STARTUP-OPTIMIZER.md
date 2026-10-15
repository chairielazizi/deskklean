# Phase 2 — Startup Optimizer (DRAFT)

**Status:** 📝 Draft — not yet approved, nothing implemented
**Depends on:** Phase 0 (system bridge) ✅ · Phase 1 (System Info) ✅

## Goal

Make the Startup Optimizer the first module that **writes** to the system. Today
`STARTUP_GET_ITEMS` returns an in-memory array and `STARTUP_TOGGLE_ITEM` /
`STARTUP_SET_DELAY` only mutate that array — no registry is read or written, and
nothing is backed up.

## Why this phase is different

Every phase so far was read-only. This one changes system state, so it introduces
two things the project has never had:

1. **UAC elevation** — writing to `HKLM\...\Run` requires administrator rights.
2. **Real backup/restore** — a write that can destroy a startup entry needs a
   rollback, or the user can lose a program's autostart permanently.

Both must land *before* any write is implemented.

---

## Open decisions (need an answer before implementation)

**D1 — Scope of "startup item".** The `StartupLocation` type already lists five
kinds: `HKCU_RUN`, `HKLM_RUN`, `STARTUP_FOLDER`, `SCHEDULED_TASK`, `SERVICE`.

Recommended: **Phase 2 covers the three registry/folder sources** (both Run keys,
RunOnce keys, both Startup folders). Scheduled tasks and services pull in the Task
Service and the Service Control Manager — a meaningfully larger surface for no
user-visible gain at this stage. Defer them to a later phase, and have the UI
show "not scanned" rather than silently omitting them.

**D2 — `setStartupItemDelay`.** Windows has **no native per-item startup delay**.
Task Manager does not offer one. Realistic options:
- (a) Drop the method and the `bootDelaySec` field — honest, simplest.
- (b) Implement it by creating a **scheduled task** that runs the command N
  seconds after logon, and removing the Run-key entry. Real, but adds a Task
  Scheduler dependency and is harder to undo cleanly.

Recommended: **(a)** for now; revisit if a user asks.

**D3 — `impact` and `estimatedBootImpactMs`.** Task Manager's startup impact is
computed from boot tracing and is **not exposed by any WMI/CIM class**. Options:
- (a) Return `'none'` / `null` and label the column "Not available".
- (b) Heuristic guess (file size, known-app list) — fabricated, violates the
  standing "never invent a value" rule.

Recommended: **(a)**. Make both nullable and render `Unavailable`.

---

## Enumeration

Read these locations. All are standard and stable across Windows 10/11.

**Run / RunOnce registry keys** (REG_SZ values, value name → command):

```
HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Run
HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\RunOnce
HKLM\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Run   (32-bit view on 64-bit OS)
HKCU\SOFTWARE\Microsoft\Windows\CurrentVersion\Run
HKCU\SOFTWARE\Microsoft\Windows\CurrentVersion\RunOnce
```

**Startup folders** (each `.lnk` / `.exe` is an item):

```
%ProgramData%\Microsoft\Windows\Start Menu\Programs\StartUp
%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup
```

Policy-driven Run keys (`...\CurrentVersion\Policies\Explorer\Run`) are read-only
and rarely populated — skip them unless the other sources come back empty.

**Publisher** is read from the target file's version info, not guessed:

```powershell
(Get-Item "<exe>").VersionInfo.CompanyName
```

Returns empty string for files without version info — render as `Unknown`, do not
invent one.

### Enabled state

The Run keys alone cannot tell enabled from disabled: Task Manager **hides** a
disabled entry rather than deleting it. The toggle state lives in:

```
HKCU\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run
HKCU\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run32
HKCU\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\StartupFolder
```

Each holds REG_BINARY values named after the startup entry. **The exact bit
encoding must be verified on a real machine before it is trusted** — this is the
single highest-risk unknown in the phase. Verify by toggling an entry in Task
Manager and re-reading the value.

> ⚠️ Verify before trusting: the StartupApproved paths and bit encoding.
> Everything else in this draft is a documented, stable location.

---

## Backup / restore

Back up **one value, not the whole key**. `reg export` on a Run key would export
every entry, so restoring it would silently re-enable anything the user had
disabled since the backup — the same clobber risk as the registry-backup bug
removed in `ad08a26`.

Instead, read the single value (name, type, data) and generate a minimal `.reg`
snippet containing only that value:

```
Windows Registry Editor Version 5.00

[HKEY_CURRENT_USER\SOFTWARE\Microsoft\Windows\CurrentVersion\Run]
"EntryName"="\"C:\\Path\\To\\App.exe\" /flag"
```

Requires a correct `.reg` string escaper — backslash and double-quote both
escaped, per the `.reg` format. Restore runs `reg import <file>`.

Backups live in `%APPDATA%\DeskKlean\backups\startup\` as
`<timestamp>-<hive>-<sanitized-entry-name>.reg`, alongside the existing
registry-backup store so the UI has one backup list.

---

## UAC elevation

The app should **not** run elevated all the time — a cleaner asking for admin on
every launch is a poor model and a larger attack surface. Follow CCleaner's model:

1. **Detect** elevation at startup. Either of these works:
   ```powershell
   # cheap, no output
   net session
   # explicit, unambiguous
   ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
   ```
2. **If elevated** — run normally.
3. **If not** — show a banner: *"Administrator rights are required to change
   startup items"* with a **Restart as administrator** button that runs
   ```powershell
   Start-Process -FilePath "<process.execPath>" -Verb RunAs
   ```
   then quits. Reads still work unelevated, so the list populates; only writes
   are gated.

Writes to `HKCU` do not need elevation. Writes to `HKLM` and to
`HKLM\...\StartupApproved` do. Gate per-item, not globally where possible.

---

## Contract changes

| Change | Detail |
|---|---|
| `StartupItem.publisher` | now real (file version info) |
| `StartupItem.enabled` | now real (StartupApproved) |
| `StartupItem.impact` | `'none'` for all items until a real source exists |
| `StartupItem.estimatedBootImpactMs` | `0` → **make nullable**, render `Unavailable` |
| `StartupItem.bootDelaySec` | removed if D2 = (a) |
| `getStartupItems()` | real enumeration + enabled state + publisher |
| `toggleStartupItem(id, enabled)` | real registry write **with backup first** |
| `setStartupItemDelay(...)` | removed if D2 = (a) |
| new `getStartupBackups()` | list startup backups |
| new `restoreStartupBackup(id)` | restore one |

`StartupItem.id` should be **stable across launches** — derive it from the
location + entry name, not from array index, or toggling after a rescan will hit
the wrong row.

---

## Files

```
src/main/system/registry.ts   NEW  — value-level .reg read/write/export/import
src/main/ipc.ts               EDIT — replace the three startup handlers
src/shared/types.ts           EDIT — nullable impact fields, new backup types
src/renderer/.../StartupOptimizer.tsx  EDIT — banner, real state, restore UI
```

`registry.ts` is deliberately separate from `cim.ts`: registry work is
`reg.exe` / PowerShell `*-ItemProperty`, not CIM.

---

## Verification (Windows)

```powershell
# what Task Manager enumerates
Get-CimInstance Win32_StartupCommand | Select Name, Command, Location, User

# the Run keys
Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Run'
Get-ItemProperty 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Run'

# the toggle state (verify the bit encoding here)
Get-ItemProperty 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run'

# elevation check
net session
```

Then toggle an entry in Task Manager, re-read `StartupApproved\Run`, and confirm
the encoding before implementing the toggle.

---

## Risks

- **StartupApproved encoding** — unverified; a wrong guess silently misreports
  every item's enabled state. Verify first, per the checklist above.
- **Elevation prompt** — `Start-Process -Verb RunAs` always shows a UAC dialog;
  there is no silent elevation. Do not try to bypass it.
- **Backup correctness** — a malformed `.reg` is worse than no backup. The
  escaper needs a test with backslashes, quotes and spaces in the command.
- **HKLM vs HKCU** — mixing them up either fails to write (HKLM unelevated) or
  writes to the wrong hive. The `id` must encode which hive it came from.
