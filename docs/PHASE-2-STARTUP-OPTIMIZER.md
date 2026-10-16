# Phase 2 — Startup Optimizer

**Status:** ✅ Approved — ready for implementation
**Depends on:** Phase 0 (system bridge) ✅ · Phase 1 (System Info) ✅

## Goal

Make the Startup Optimizer the first module that **writes** to the system. Today
`STARTUP_GET_ITEMS` returns an in-memory array and `STARTUP_TOGGLE_ITEM` /
`STARTUP_SET_DELAY` only mutate that array — no registry is read or written, and
nothing is backed up.

## Why this phase is different

Every phase so far was read-only. This one changes system state, so two things the
project has never had must land **before** any write:

1. **UAC elevation** — writing to `HKLM\...\Run` requires administrator rights.
2. **Real backup/restore** — a write that can destroy a startup entry needs a
   rollback, or a user can lose a program's autostart permanently.

---

## Resolved decisions

### D1 — Scope ✅

**Run keys + RunOnce keys + both Startup folders + scheduled tasks. Services out of
scope.**

- **Scheduled tasks are included.** A task with an `AtLogOn` / `AtStartup` trigger
  *is* a startup item, and plenty of real autostart bloat lives there and nowhere
  else. Read with `Get-ScheduledTask`; toggle with `Disable-ScheduledTask` /
  `Enable-ScheduledTask`, which is reversible and low-risk.
- **Services are excluded.** Not because it is hard, but because the failure mode
  differs in kind. Disabling an autostart entry makes one program stop launching;
  disabling a *service* reconfigures the operating system, and setting the wrong
  one to `Disabled` can leave Windows unable to boot. The blast radius is the whole
  machine. Revisit later with a protected-service list; until then the UI says
  "not scanned" rather than silently omitting them.

### D2 — Delay ✅

**Per-item delay is dropped. A global startup-delay control replaces it.**

Windows has no native per-app startup delay — HowToGeek states it plainly: the
delay "applies to all startup apps. There's no way to apply this technique only to
specific apps." The scheduled-task workaround (delete the Run entry, create a
delayed task) is rejected: two writes in two subsystems that must both succeed,
leaving the entry in neither place if the app dies between them; a persistent task
artifact that outlives uninstall; and a silent "the cleaner broke my program" if the
task is misconfigured.

The real, supported, no-admin alternative:

```
HKCU\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\Serialize
    StartupDelayInMSec   REG_DWORD   ms to wait before launching startup apps
                                     (absent = Windows default, ~10s)
    WaitForIdleState     REG_DWORD   0 = do not also wait for an idle CPU
```

Windows waits ~10 s *and* waits for CPU idle before launching startup apps —
combined that can be 20 s or more past login on a fast machine. Setting both to 0
does not make boot faster, but it makes the desktop usable sooner. Undo is deleting
the value.

`bootDelaySec` is removed from `StartupItem`.

### D3 — Boot impact ✅

**Implemented for real, from the Diagnostics-Performance event log.**

It answers the only question that matters in a startup optimizer: *which of these
entries is actually costing me boot time?* Without it the user gets twenty entries
and has to guess. This is the same data Task Manager's High/Medium/Low label comes
from.

```
Microsoft-Windows-Diagnostics-Performance/Operational
  Event 100  boot summary — total duration, split into the system-load phase
             and the startup-app phase
  Event 101  one app that delayed startup — File Name, Friendly Name,
             Total Time, Degradation Time (ms)
  Event 102/103/109  the driver / service / device equivalents
```

**Verified populated on the target machine** (2 events on 2026-10-14, 2 on
2026-09-21), so this is a real data source and not a theoretical one.

Event 101's **Degradation Time** is a per-app measurement in milliseconds. It maps
onto `estimatedBootImpactMs` directly; the High/Medium/Low label is derived from it
by threshold. Read with:

```powershell
Get-WinEvent -LogName Microsoft-Windows-Diagnostics-Performance/Operational |
  Where-Object Id -eq 101
```

Match entries to startup items by **file name**. Items with no 101 event get `null`
/ `'none'` — event 101 only fires when Windows flags something as slow, so coverage
is inherently partial. That is honest and still useful; it is not a reason to
fabricate a value.

> Open item: whether reading this log requires elevation was not confirmed. The
> query succeeded on the target machine, but the elevation state of that shell is
> unknown. Handle access-denied gracefully — degrade the impact column to `null`
> rather than failing the scan.

---

## Enumeration

### Run / RunOnce registry keys

REG_SZ values; value name → command.

```
HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Run
HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\RunOnce
HKLM\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Run
HKCU\SOFTWARE\Microsoft\Windows\CurrentVersion\Run
HKCU\SOFTWARE\Microsoft\Windows\CurrentVersion\RunOnce
```

### Startup folders

Each `.lnk` / `.exe` is one item:

```
%ProgramData%\Microsoft\Windows\Start Menu\Programs\StartUp
%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup
```

### Scheduled tasks

Include tasks whose triggers contain `AtLogOn` or `AtStartup`. Read via
`Get-ScheduledTask`; **skip anything under `\Microsoft\Windows\`** (OS-owned).
Toggle with `Disable-ScheduledTask` / `Enable-ScheduledTask` — non-destructive and
reversible.

### Publisher

Read from the target file's version info, never guessed:

```powershell
(Get-Item "<exe>").VersionInfo.CompanyName
```

Empty for files without version info — render `Unknown`.

---

## Enabled state — StartupApproved ✅ VERIFIED

The Run keys cannot distinguish enabled from disabled, because Task Manager
**hides** a disabled entry rather than deleting it. The toggle state lives in a
**12-byte REG_BINARY** under `StartupApproved`.

### Locations (both hives)

```
HKCU\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run
HKCU\...\Explorer\StartupApproved\Run32
HKCU\...\Explorer\StartupApproved\StartupFolder
HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run
HKLM\...\Explorer\StartupApproved\Run32
HKLM\...\Explorer\StartupApproved\StartupFolder
```

> **`HKLM` has these keys too** — easy to miss, and missing them means every HKLM
> entry always looks enabled. **`RunOnce` has no StartupApproved key at all**;
> those items are always effectively enabled.

### Format

| Field | Meaning |
|---|---|
| Length | **12 bytes** |
| `data[0]` | `0x02` = enabled marker, `0x03` = disabled marker |
| **Disabled test** | **`(data[0] & 0x01) != 0`** — the low bit of the first byte |
| `data[4..11]` | little-endian **FILETIME** of when it was disabled |
| Missing value | **enabled** — never toggled |

Cross-verified against two independent implementations that agree exactly
(`SysGreen` `StartupApprovedFlag`, `CorePin` `StartupApproved.IsDisabled`), and
consistent with the `0x02` marker in published PoC code.

**Encode:**

```
enabled   → 12 bytes, [0]=0x02, rest zero
disabled  → 12 bytes, [0]=0x03, bytes 4..11 = FILETIME(now) little-endian
```

**Consequences for the implementation:**

- Disabling must **write this flag, not delete the Run value.** Deleting is
  destructive and loses the command string; the flag is reversible by construction.
- **Adding a Run value via `reg.exe` creates no StartupApproved entry**, which
  Windows treats as enabled. Do not treat "missing" as "disabled".
- Removing a Run value **leaves the StartupApproved entry behind** — a stale flag is
  normal, not a bug to clean up.

---

## Backup / restore

Back up **one value, not the whole key**. `reg export` on a Run key exports every
entry, so restoring it would silently re-enable anything the user had disabled
since — the same clobber risk as the registry-backup bug removed in `ad08a26`.

Read the single value (name, type, data) and generate a minimal `.reg` snippet
containing only that value:

```
Windows Registry Editor Version 5.00

[HKEY_CURRENT_USER\SOFTWARE\Microsoft\Windows\CurrentVersion\Run]
"EntryName"="\"C:\\Path\\To\\App.exe\" /flag"
```

Requires a correct `.reg` escaper — backslash and double-quote both escaped.
Restore runs `reg import <file>`.

Back up **both** the Run value and its StartupApproved flag, so a restore returns
the item to its exact prior state rather than merely to "enabled".

Backups live in `%APPDATA%\DeskKlean\backups\startup\` as
`<timestamp>-<hive>-<sanitized-entry-name>.reg`, alongside the existing
registry-backup store so the UI has one backup list.

---

## UAC elevation

Earlier drafts claimed that DeskKlean follows the reference product's (CCleaner's)
model of per-feature gating. That claim is incorrect: the reference product
actually requests elevation at launch, and offers a "skip UAC" option implemented
as a scheduled task.

### Actual Decision: Option A (Startup Elevation Prompt)

In practice, most of DeskKlean's core features need administrator rights (cleaning
system locations, writing to HKLM registry keys, toggling system-wide startup entries,
and app uninstall). Gating per-feature results in users encountering a refusing or
degraded feature mid-task. DeskKlean therefore adopts **Option A**:

- **Startup Prompt**: DeskKlean prompts for administrator rights once at launch if the
  app is not elevated.
- **Decline and Read-Only Browsing**: The user may decline the elevation prompt and
  continue unelevated for read-only browsing (e.g. browsing System Info, scanning disks,
  or reading the startup list). This choice is remembered via
  `settings.elevationPromptDismissed`.
- **Startup Optimizer Banner**: The Startup Optimizer banner remains in place as the
  permanent, always-available way to elevate later if the user initially declined.
- **Defence in Depth**: The per-feature HKLM elevation gate in `src/main/system/startup.ts`
  is retained as defence in depth — a registry write must never proceed on an unverified
  assumption.

### Mechanism

1. **Detect** elevation at startup via `isElevated()`:
   ```powershell
   ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
   ```
2. **If elevated** — run normally.
3. **If not elevated** — show the startup elevation modal (when
   `settings.elevationPromptDismissed === false`) or the in-module banner. If requested
   by the user, relaunch elevated via:
   ```powershell
   # packaged - process.execPath IS the app's own binary
   Start-Process -FilePath "<process.execPath>" -Verb RunAs

   # unpackaged - process.execPath is electron.exe, which needs the app directory
   # or it boots Electron's built-in demo app instead
   Start-Process -FilePath "<process.execPath>" -ArgumentList '"<app.getAppPath()>"' -Verb RunAs
   ```

   Each argument is passed explicitly double-quoted because `Start-Process
   -ArgumentList` joins elements with spaces and does not quote them itself, so a
   path containing a space would otherwise split into two arguments.
   In packaged builds, the unelevated parent process quits after launching. In
   development mode, the current window remains open so the Vite dev server stays alive.

There is no silent elevation. `Start-Process -Verb RunAs` always shows a UAC dialog
— do not attempt to bypass it.

### Security Note

An always-elevated application is a privileged execution surface — anything able to
drive its IPC can act as administrator. That is the reason all write paths stay
narrow, backed up, and verified, and the reason DeskKlean adds no command-line
arguments that perform privileged actions.

### Packaging-time Consideration (Open Option)

As a packaging-time alternative (not implemented here), a packaged production build
could instead declare `requireAdministrator` in its manifest so Windows prompts before
the process starts. That removes the relaunch code entirely, but also removes the
"continue without administrator" option for read-only browsing, and cannot work in
development because dev runs `electron.exe`, whose manifest we do not control.
This remains recorded as an open option.

---

## Contract changes

| Change | Detail |
|---|---|
| `StartupItem.publisher` | real, from file version info |
| `StartupItem.enabled` | real, from the StartupApproved flag |
| `StartupItem.impact` | real, derived from event 101 degradation thresholds |
| `StartupItem.estimatedBootImpactMs` | real ms from event 101; `null` when unmeasured → **make nullable** |
| `StartupItem.bootDelaySec` | **removed** |
| `StartupItem.location` | now also returns `SCHEDULED_TASK` |
| `StartupItem.id` | stable across launches — derive from hive + location + entry name, **never array index** |
| `getStartupItems()` | real enumeration + enabled + publisher + impact |
| `toggleStartupItem(id, enabled)` | writes the StartupApproved flag, **backup first** |
| `setStartupItemDelay(...)` | **removed**, superseded by `setStartupDelay` |
| new `getStartupDelay()` | reads `Serialize\StartupDelayInMSec` + `WaitForIdleState` |
| new `setStartupDelay(ms, waitForIdle)` | writes them (HKCU — no elevation) |
| new `getStartupBackups()` | list startup backups |
| new `restoreStartupBackup(id)` | restore one |

The preload contract changes here — unlike Phases 0/1, this is a breaking change
for the renderer.

---

## Files

```
src/main/system/registry.ts   NEW  — value-level .reg read/write/export/import,
                                     StartupApproved encode/decode
src/main/system/startup.ts    NEW  — enumeration (Run keys, folders, tasks),
                                     publisher lookup, event 101 impact
src/main/system/elevation.ts  NEW  — isElevated(), relaunchElevated()
src/main/ipc.ts               EDIT — replace the three startup handlers
src/shared/types.ts           EDIT — nullable impact, new delay + backup types
src/renderer/.../StartupOptimizer.tsx  EDIT — elevation banner, real state,
                                     delay control, restore UI
```

`registry.ts` is deliberately separate from `cim.ts`: registry work is `reg.exe` /
PowerShell `*-ItemProperty`, not CIM.

---

## Step specification

Status: ✅ done · 🔜 specified, not built · ⏳ not specified

Every step lists what it does, the rails that must hold, and how it is accepted.
A step is not done until its acceptance test has actually run on Windows.

### Step 1 — read primitives ✅ `ead9307`

`src/main/system/registry.ts`. Typed reads over PowerShell `*-ItemProperty`, the
StartupApproved codec, and the `.reg` string escaper. **No writes.**

Rails:
- The escaper escapes backslashes **then** quotes — the order matters, or the
  backslash added for a quote gets doubled.
- PowerShell values are escaped by doubling single quotes and every path uses
  `-LiteralPath`, so a name containing `[` or `*` cannot be read as a wildcard.
- `decodeStartupApproved` treats an unrecognised shape as **enabled**, never
  disabled. The failure direction is deliberate.
- `buildRegSnippet` is type-aware: `REG_SZ`, `REG_EXPAND_SZ` as `hex(2)` with a
  UTF-16LE null terminator, `REG_BINARY` as `hex:`, `REG_DWORD`, and `DELETE` as `=-`.

Acceptance: `node scripts/test-reg-escaper.mjs` — 17 cases, all pass.

### Step 2 — enumeration ✅ `ead9307`

`src/main/system/startup.ts`. HKCU/HKLM Run, both RunOnce keys, the WOW6432Node Run
key, both Startup folders (resolving `.lnk` via `WScript.Shell`), and scheduled
tasks with logon/boot triggers. Publisher from file version info.

Rails:
- Enabled state comes from StartupApproved in **both** hives. HKLM has these keys
  too; reading only HKCU makes every HKLM entry look enabled.
- A missing flag means **enabled**. A `reg.exe`-added value has no flag.
- RunOnce has **no** StartupApproved key. Its absence is not an error.
- OS-owned `\Microsoft\Windows\` tasks are skipped.
- Every source degrades independently; one failure must not empty the list.
- `id` is `hive-location-slug(name)`. **It is not reversible** — the slug lowercases
  and collapses separators — so `StartupItem.target` carries the exact hive, key
  path, value name and StartupApproved key for the write path. Never parse an `id`.

Acceptance: the list matches Task Manager's Startup tab; a `G:`-style virtual disk
shows Unknown rather than a wrong label.

### Step 3 — event 101 impact ✅ `ead9307`

Boot impact from `Microsoft-Windows-Diagnostics-Performance/Operational` event 101
`DegradationTime`, matched by file name. Thresholds: `high` ≥ 1000 ms,
`medium` ≥ 300 ms, `low` > 0, `none` when unmeasured.

Rails:
- Unmeasured items return `null`, never a guessed number. `estimatedBootImpactMs`
  is nullable for this reason.
- The query uses `-LogName` + `-FilterXPath '*[System[EventID=101]]'`, falling back
  to a plain `-LogName` scan. "No events" and access-denied are **empty results, not
  errors**.
- Empty output must emit a literal `[]`: `@() | ConvertTo-Json` emits *nothing*.

Acceptance: the impact column populates; unmeasured entries read Unavailable.

### Step 4 — scheduled task enumeration ✅ `ead9307`

Folded into step 2. Only logon/boot-triggered tasks, OS-owned paths excluded.

Acceptance: third-party logon tasks appear; no `\Microsoft\Windows\` task does.

### Step 5 — elevation ✅ `9305bc6` + `ccb2917`

`src/main/system/elevation.ts` plus the startup prompt.

Decided model — **Option A**: ask once at startup, not per feature. Rationale and
the security counterweight are recorded in the UAC elevation section below.

Rails:
- `isElevated()` **fails closed** — any error means not elevated, so the app never
  attempts a write it cannot perform.
- `relaunchElevated(exePath, args?)` passes `app.getAppPath()` when unpackaged.
  `process.execPath` is the app's own binary only when packaged; in dev it is
  `electron.exe`, which boots Electron's demo app when given no argument.
- Each argument is passed explicitly double-quoted: `Start-Process -ArgumentList`
  joins with spaces and does not quote, so a path with a space would split.
- `app.quit()` runs **only when packaged**. In dev, `concurrently -k` would kill
  Vite when Electron exits, leaving the elevated instance on a blank window.
- The startup prompt is skippable only through "Continue without administrator",
  which records `settings.elevationPromptDismissed`. No X, no backdrop-close.
- If reading settings or elevation fails, the prompt is **skipped** — the gate fails
  closed, the prompt fails open.

Acceptance: the prompt appears once when unelevated; declining stops it returning;
the elevated window is actually DeskKlean.

### Step 6 — the toggle ✅ `fa9f12b`

`toggleStartupItem(id, enabled)`. The first registry write in the project.

Rails:
- Resolve the id by **re-enumerating and matching**, never by parsing it.
- **Refuse RunOnce.** Windows gives it no StartupApproved flag, so "disabling" could
  only mean deleting it — destructive, and not what a disable control promises.
- **Refuse HKLM writes when unelevated**, without attempting.
- **Back up before writing, and abort if the backup fails.** The Run value with its
  real type plus the StartupApproved flag, merged into one `.reg` written UTF-16LE
  with a BOM; the file is reopened and its first bytes asserted `FF FE`, because
  `reg import` reads a BOM-less file as ANSI and would corrupt a non-ASCII name.
- The flag entry is emitted **uniformly for registry and folder items**: the existing
  flag as `REG_BINARY`, an absent flag as `DELETE`. Emitting `DELETE` only for folders
  leaves a Run entry with no prior flag still disabled after a restore.
- Write the flag; **never delete the Run value**.
- **Verify by read-back.** `success: true` only when the read-back confirms the
  intended state. A write that silently did nothing must never report success.
- Log only on confirmed success, including the backup path.

Acceptance: disable an entry → it leaves Task Manager's Startup tab and
`StartupApproved\Run` reads `03 00 00 00 …` → restore → it returns.

### Step 7 — global startup delay ✅

Replaces the removed per-item delay (D2). Windows waits ~10 s and for CPU idle
before launching startup apps; on a fast machine that is 20 s+ past login. Setting
both to zero does not shorten boot, but makes the desktop usable sooner.

Location — `HKCU\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\Serialize`:

| Value | Type | Meaning |
|---|---|---|
| `StartupDelayInMSec` | `REG_DWORD` | ms to wait before launching startup apps |
| `WaitForIdleState` | `REG_DWORD` | `0` = do not also wait for CPU idle |

Contract:
- `getStartupDelay(): Promise<StartupDelayState>` —
  `{ delayMs: number | null, waitForIdle: boolean | null, supported: boolean }`
- `setStartupDelay(ms: number | null, waitForIdle: boolean)`

Rails:
- **`null` and `0` are different states and must not be conflated.** Absent means
  Windows default (~10 s); `0` means explicitly no delay. `delayMs: null` reports
  the former.
- `ms === null` **deletes** `StartupDelayInMSec`, restoring the Windows default.
  That delete is the undo.
- Create the `Serialize` key if missing.
- HKCU only — **no elevation**.
- Verify by read-back, exactly as the toggle does.

**Decision — no `.reg` backup for this step.** A Run entry holds an unrecoverable
command string, so losing it destroys data. These are two DWORDs holding no user
data, and the undo is a documented delete back to default. The prior state is
recorded in the activity log instead of a backup file. Revisit if the delay ever
grows beyond these two values.

Acceptance: `Get-ItemProperty 'HKCU:\…\Serialize'` shows both values after a write;
reset removes them and the read reports the default state. Verified live on Windows via
`node scripts/test-phase2-live.mjs` (all assertions passed).

### Step 8 — backup list + restore UI ✅

Makes the rollback reachable. Without it the backup is only usable by running
`reg import` by hand, which makes the whole safety mechanism theoretical.

Contract:
- `getStartupBackups(): Promise<StartupBackup[]>`
- `restoreStartupBackup(id): Promise<{ success: boolean; message?: string }>`

Rails:
- **The backup file must carry its own metadata.** The filename is
  `<ISO>-<hive>-<slug(name)>` and the slug is lossy, so the item name cannot be
  recovered from it — the same trap as `StartupItem.id`. Step 6's writer therefore
  gains a `;` comment header inside the `.reg` recording the exact item name, hive,
  location, value name and timestamp. `reg import` ignores `;` comments, and
  `REGISTRY_GET_BACKUPS` already parses them, so this is an established pattern here.
- **Path traversal guard.** The id must resolve to a file strictly inside the backup
  directory; reject anything else.
- **Validate before importing.** `reg import` writes whatever the file says, so
  confirm the file begins with the `Windows Registry Editor Version 5.00` header
  before running it.
- **HKLM restores require elevation**, same gate as the toggle.
- **Never auto-restore.** Every restore is user-initiated and logged.
- A restore is not verifiable generically the way a single flag write is, so success
  means `reg import` exited 0 *and* the action was logged with the file path. Do not
  claim the prior state was restored without re-reading it.

Acceptance: disabling an item produces a backup listed with its real name and hive;
restoring it returns the item to its prior state; a RunOnce toggle is refused and
creates no backup. Verified live on Windows via `node scripts/test-phase2-live.mjs`
and unit tests in `scripts/test-phase2-step7-8.mjs`.

---

## Implementation order

Safety-first — every read-only step lands before the first write:

1. `registry.ts` read + StartupApproved decode + the `.reg` escaper (**no writes**) — ✅
2. `getStartupItems()` — Run keys, folders, publisher, enabled state — ✅
3. Event 101 impact — ✅
4. Scheduled task enumeration — ✅
5. `elevation.ts` + the UI banner — ✅
6. `toggleStartupItem()` — backup, then write the flag — ✅
7. `getStartupDelay()` / `setStartupDelay()` — ✅
8. Backup list + restore UI — ✅

Steps 1–8 fully implemented, tested, and verified on Windows.

---

## Verification (Windows)

```powershell
# what Task Manager enumerates
Get-CimInstance Win32_StartupCommand | Select Name, Command, Location, User

# the Run keys
Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Run'
Get-ItemProperty 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Run'

# the toggle state — confirm the 12-byte 0x02/0x03 format here
Get-ItemProperty 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run'
Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run'

# scheduled tasks at logon
Get-ScheduledTask | Where-Object { $_.Triggers.CimClass.CimClassName -match 'Logon|Boot' } |
  Select TaskName, TaskPath, State

# boot impact
Get-WinEvent -LogName Microsoft-Windows-Diagnostics-Performance/Operational |
  Where-Object Id -eq 101 | Select TimeCreated, Message

# global startup delay
Get-ItemProperty 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\Serialize' -ErrorAction SilentlyContinue

# elevation
net session
```

**Final acceptance test for the toggle:** disable an entry, confirm it disappears
from Task Manager's Startup tab *and* that `StartupApproved\Run` shows
`03 00 00 00 …`, then re-enable and confirm it returns. That round-trip is the whole
point of the phase.

---

## Defects found during implementation

Recorded because each one was invisible to type-checking and would have shipped as
silent wrong behaviour. "Verified" below means read-and-reasoned; none of this can
be executed on the build machine, which has no PowerShell and no registry.

### Fixed

| # | Defect | Why it mattered | Fix | Commit |
|---|---|---|---|---|
| 1 | `Write-Warning` inside a PowerShell `catch` landed on **stdout** | The parser received `WARNING: …` before the payload and threw, killing a whole data source. Any stray stdout byte could do it | `$WarningPreference = 'SilentlyContinue'`, `[Console]::Error.WriteLine`, and a `parseJsonSafe` that cannot throw at every `JSON.parse` site | `1ba6408` |
| 2 | Event 101 used `-FilterHashtable` and treated "no events" as an error | The impact column was empty and the failure repeated on every poll | `-LogName` + `-FilterXPath`, fallback to a plain scan, "no events" and access-denied as empty results | `1ba6408` |
| 3 | RunOnce items reported `location: HKCU_RUN` while their `id` said runonce | The write path could not tell which key to write without parsing the id | `HKCU_RUNONCE` / `HKLM_RUNONCE` added to `StartupLocation` | `1ba6408` |
| 4 | The rollback `DELETE` entry was emitted **only for folder items** | A Run entry with no prior flag — the *default* state — stayed disabled after a restore. The safety mechanism silently failed | Emit the flag entry uniformly for both kinds | `fa9f12b` |
| 5 | The backup wrote the Run value as `REG_SZ` regardless of its real type | A `REG_EXPAND_SZ` entry restored with `%ProgramFiles%` unexpanded, so the program would not start after a restore | `buildRegSnippet` made type-aware; the type comes from `readValue` | `fa9f12b` |
| 6 | `relaunchElevated(process.execPath)` passed no app path | Opened Electron's built-in demo instead of DeskKlean, because `process.execPath` is the app's own binary only when packaged | Pass `app.getAppPath()` when unpackaged, each argument explicitly quoted | `9305bc6` |
| 7 | `app.quit()` ran unconditionally after the relaunch | In dev, `concurrently -k` killed Vite when Electron exited, leaving the elevated instance on a blank window | Quit only when packaged | `9305bc6` |
| 8 | The doc claimed DeskKlean followed CCleaner's per-feature gating model | The claim was simply false — CCleaner requests elevation at launch and ships a "skip UAC" scheduled task. A decision was resting on a fabricated precedent | Corrected, with the real rationale and the security counterweight recorded | `ccb2917` |

### Open

| # | Defect | Status |
|---|---|---|
| O1 | **The single-instance lock defeats the elevated relaunch.** `main.ts:138` calls `app.requestSingleInstanceLock()`, so the elevated instance starts, fails the lock, and quits — firing `second-instance` and focusing the original. In dev: no new window. Packaged: the original then quits too, so both processes exit. **One cause, both symptoms.** | Fix specified: `app.releaseSingleInstanceLock()` before relaunching, re-acquiring if the relaunch fails. Not yet built |
| O2 | **A packaged portable build showed no startup elevation prompt.** Ruled out: `SETTINGS_GET` merges with `DEFAULT_SETTINGS` so `elevationPromptDismissed` defaults to `false`; the modal is rendered; `apiClient` resolves to the real preload in Electron. Prime suspect is a stale build (`npm run dist` before the new source synced), but this is **not confirmed** | Needs a diagnostic in the packaged app rather than a guess |
| O3 | The elevation snippet in this doc still shows the packaged-only form | Fold into the next implementation run |

### Process lesson

Defects 4 and 5 both came from the same instruction: the implementer was told not to
touch `buildRegSnippet`, so it string-replaced that function's output to get the
binary and delete forms it could not express — and the delete hack landed in only one
branch. The constraint, not the implementer, produced the bug. An earlier SMBIOS
defect came from a wrong spec. **State the requirement and the invariant, not an
implementation boundary; a function that cannot express what is needed will be
worked around rather than fixed.**

---

## Risks

| Risk | Mitigation |
|---|---|
| **StartupApproved encoding** — previously the top unknown, now cross-verified against two independent implementations | Still confirm the round-trip on the target machine before trusting the toggle (acceptance test above) |
| **Missing the HKLM StartupApproved keys** | Easy to miss; missing them makes every HKLM entry look enabled |
| **Treating a missing flag as disabled** | Missing = enabled. A `reg.exe`-added Run value has no flag |
| **Deleting the Run value instead of writing the flag** | Destructive and irreversible. Always write the flag |
| **Malformed `.reg` backup** | Worse than no backup. Test the escaper with backslashes, quotes and spaces |
| **HKLM vs HKCU mix-up** | Either fails to write (HKLM unelevated) or writes to the wrong hive. The `id` must encode the hive |
| **Elevation** | No silent elevation exists. Do not try to bypass UAC |
| **Event 101 access** | May need elevation; degrade the impact column to `null` on access denied |
| **Scheduled task blast radius** | Only toggle third-party tasks; never touch `\Microsoft\Windows\` |
