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

The app should **not** run elevated all the time. Follow CCleaner's model:

1. **Detect** elevation at startup — either:
   ```powershell
   net session
   ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
   ```
2. **If elevated** — run normally.
3. **If not** — show a banner: *"Administrator rights are required to change
   startup items"*, with **Restart as administrator**:
   ```powershell
   Start-Process -FilePath "<process.execPath>" -Verb RunAs
   ```
   then quit.

**Reads still work unelevated**, so the list populates regardless; only writes are
gated. Gate per item: `HKCU` writes need no elevation; `HKLM` writes and the
`Serialize` global-delay writes do.

There is no silent elevation. `Start-Process -Verb RunAs` always shows a UAC dialog
— do not attempt to bypass it.

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

## Implementation order

Safety-first — every read-only step lands before the first write:

1. `registry.ts` read + StartupApproved decode + the `.reg` escaper (**no writes**)
2. `getStartupItems()` — Run keys, folders, publisher, enabled state
3. Event 101 impact
4. Scheduled task enumeration
5. `elevation.ts` + the UI banner
6. `toggleStartupItem()` — backup, then write the flag
7. `getStartupDelay()` / `setStartupDelay()`
8. Backup list + restore UI

Steps 1–4 are read-only and safe to ship on their own. Step 6 is the first write
and must not be attempted before step 5 works.

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
