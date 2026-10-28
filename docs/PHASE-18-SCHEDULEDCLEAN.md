# Phase 18 — Scheduled Cleaning (headless CLI + Task Scheduler)

**Status:** 🔜 specified, not built
**Depends on:** Phase 3 (framework) ✅ · Phase 5/6 (SmartClean) ✅ · Phase 17 (custom rules, for exclusion handling)
**Classification:** minor (new capability, no schema change)
**Design refs:** DESIGN-DECISIONS Q6 (on-demand only; scheduled cleaning rides Task Scheduler, no service), D-11-2 (headless CLI)

---

## Goal

Make `AppSettings.scheduledCleanEnabled` / `scheduledCleanFrequency` do something. Today both are
persisted (`src/shared/types.ts:607-608`) and rendered as a toggle + frequency select
(`Settings.tsx:231-248`), and there is **no IPC handler and no Task Scheduler integration**. The
toggle is a lie: it stores a preference that nothing reads.

## 1. Architecture — decided (D-11-2)

```
Task Scheduler ──runs──> DeskKlean.exe --scheduled-clean
                              │
                              ├─ no window, no tray
                              ├─ load settings.json
                              ├─ refuse if disabled
                              ├─ scan DEFAULT categories only
                              ├─ plan -> execute -> verify (framework)
                              ├─ write JSON report + activity log
                              └─ exit code
```

- **No always-on service.** Q6 stands.
- **No GUI automation.** The scheduled path is a headless mode of the same executable, using the
  same scan/plan/execute code. It is not a second implementation of cleaning.
- **No new destructive primitive.** Everything routes through the existing framework.

## 2. CLI entry point

In `src/main/main.ts`, before window creation:

```ts
const SCHEDULED_CLEAN_FLAG = '--scheduled-clean';
const isScheduledRun = process.argv.includes(SCHEDULED_CLEAN_FLAG);
```

If `isScheduledRun`:

1. Skip `createWindow()`, tray creation, and `setupIpcHandlers()` entirely.
2. `await app.whenReady()`, run `runScheduledClean()`, then `app.exit(code)`.

`main.ts` must not call `app.quit()` for this path — the report must be flushed first.

**Also remove the hard-coded dev log path while here.** `main.ts:8` sets
`const rootLogFile = 'E:\\Coding\\antigravity-projects\\DeskKlean\\debug.log'` — an absolute path from
the author's dev machine. On a user's machine every write fails (silently, inside `try/catch`). Gate
it on `!app.isPackaged` or delete it; the `userData` log is the real one.

## 3. New module — `src/main/system/scheduledClean.ts`

### 3.1 Types

```ts
export interface ScheduledCleanReport {
  startedAt: string;
  finishedAt: string;
  trigger: 'task-scheduler' | 'manual';
  appVersion: string;
  elevated: boolean;
  skippedReason: string | null;   // set when nothing was attempted
  categories: ScheduledCategoryOutcome[];
  totals: {
    completed: number;
    failed: number;
    skipped: number;
    reclaimedBytes: number | null; // null when no category measured
  };
}

export interface ScheduledCategoryOutcome {
  id: string;
  name: string;
  status: 'cleaned' | 'failed' | 'skipped';
  reason?: string;            // why skipped/failed — required when not 'cleaned'
  reclaimedBytes: number | null;
  filesRemoved: number | null;
}
```

### 3.2 `runScheduledClean(opts): Promise<{ report, exitCode }>`

| Step | Behaviour |
|---|---|
| 1. Load settings | Read `settings.json` from `userData` (same file/format as `ipc.ts:118`). Missing or unreadable file → treat as `scheduledCleanEnabled: false`, reason `settings unreadable`. |
| 2. Gate | If `!scheduledCleanEnabled` → write a report with `skippedReason: 'scheduled cleaning is disabled'`, exit `0`. **Nothing is scanned or deleted.** |
| 3. Scope | Scan **`DEFAULT_CATEGORIES` only.** Never `OPT_IN_CATEGORIES`, never `UNVERIFIED_CATEGORIES`, never `customRules`, never user-selected categories. A scheduled run cannot be given new scope by a settings file that a previous UI session left behind. |
| 4. Elevation | `isElevated()`. Unelevated → categories with `adminRequired: true` are marked `skipped` with reason `requires elevation`. **Never silently attempt them and report success.** |
| 5. Scan | `scanSmartClean(defaultIds, { env, customExcludedPaths: settings.excludedPaths })`. |
| 6. Plan | `createSmartCleanPlan(report, defaultIds)` — framework rails apply unchanged (protected list, path validation, reversibility declaration). |
| 7. Execute | `executeOperationPlan(plan)`. Verify by read-back as the framework already does. |
| 8. Report | Write `%APPDATA%\deskklean\scheduled-reports\<ISO-8601>.json`, append one activity-log entry, prune to the newest 30 reports. |
| 9. Exit | `0` all completed · `1` partial (any failed/skipped) · `2` fatal (could not run at all). |

### 3.3 Why default categories only

`DEFAULT_CATEGORIES` are the Microsoft-documented, Disk-Cleanup-cleaned, `verdict: 'SAFE'` set, and
they are all regenerable system junk with `deletionMethod: 'permanent'` — no user data. A scheduled,
unattended run is exactly the context where a wider scope is indefensible: there is nobody to read a
confirmation. Opt-in and unverified categories exist because they need a human, so an unattended run
cannot touch them.

If `settings.excludedPaths` names a path inside a default category, that path is excluded
(`customExcludedPaths` already supports this).

## 4. Task Scheduler integration

New module `src/main/system/taskScheduler.ts`, PowerShell-backed (same bridge discipline as
`powershell.ts`: no `shell: true`, UTF-8, timeout-guarded).

```ts
export const TASK_NAME = 'DeskKlean\\ScheduledClean';

export async function registerScheduledTask(
  frequency: 'daily' | 'weekly' | 'monthly',
  opts?: { exePath?: string }
): Promise<{ ok: boolean; reason?: string; nextRun?: string | null }>;

export async function unregisterScheduledTask(): Promise<{ ok: boolean; reason?: string }>;

export async function getScheduledTaskState(): Promise<{
  registered: boolean;
  nextRun: string | null;      // real NextRunTime, null when not registered
  lastRun: string | null;
  lastResult: number | null;   // real LastTaskResult
  reason?: string;
} | null>;                     // null when the query itself failed
```

### 4.1 Registration rails

- **Portable builds refuse.** `PORTABLE_EXECUTABLE_FILE` set → return
  `{ ok: false, reason: 'portable builds cannot be scheduled — the executable runs from a temp directory' }`.
  Registering a temp path produces a task that silently stops working; refusing is the honest answer.
- **Dev/unpackaged builds refuse** for the same reason (`!app.isPackaged`).
- **The action is the installed exe** with `-Argument '--scheduled-clean'`, resolved from
  `process.execPath` — never a hard-coded path, never `%LOCALAPPDATA%` guessed by string.
- **Run level:** register with `-RunLevel Highest` so admin-required categories are available. If the
  current user cannot create a highest-privilege task, fall back to a normal-level task **and report
  that limitation** to the caller, so the UI can state which categories will be skipped.
- **Verify by re-query.** After registering, call `getScheduledTaskState()` and require
  `registered: true` before reporting success. A registration that did not stick is a failure.
- **Triggers:** `daily` → `-Daily`, `weekly` → `-Weekly -DaysOfWeek Sunday`, `monthly` → `-Monthly -DaysOfMonth 1`.
  Use `New-ScheduledTaskTrigger`; do not hand-write XML.
- **No `DisallowStartIfOnBatteries` default surprises:** set `-Settings (New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopIfGoingOnBatteries)` and state in the UI that a missed run starts at next opportunity.

### 4.2 Unregistration

On disable: `Unregister-ScheduledTask -TaskName ... -Confirm:$false`, then re-query to confirm it is
gone. If unregistration fails, **the Settings toggle must not stay off** — revert it and show why. A
toggle that says "off" while a task still runs nightly is the worst possible state.

## 5. IPC

```ts
SCHEDULED_GET_STATE: 'scheduled:getState',
SCHEDULED_SET_ENABLED: 'scheduled:setEnabled',   // registers or unregisters
SCHEDULED_RUN_NOW: 'scheduled:runNow',           // optional; runs the same headless path in-process
```

`SCHEDULED_SET_ENABLED` takes `{ enabled, frequency }`, performs the real registration/unregistration,
persists the setting only on success, and returns the resulting state. On failure it returns the
reason and the setting is left unchanged.

## 6. Renderer (Settings → Cleaning)

Replace the current cosmetic toggle with:

- Toggle → calls `SCHEDULED_SET_ENABLED`. On failure: toggle reverts, inline error shows the reason.
- Frequency select → re-registers with the new trigger; shows the new real `nextRun`.
- Status line, from `getScheduledTaskState()`:
  - registered → *"Next run: <real NextRunTime>"* + last result
  - not registered → *"Not scheduled"*
  - query failed → *"Could not read scheduled task state"* (**never** "Not scheduled" — those are
    different facts)
- Portable build → the toggle is disabled with the reason shown inline.

## 7. Tests — `scripts/test-scheduled-clean.mjs` (new, pure logic)

| # | Test |
|---|---|
| 1 | `--scheduled-clean` is detected in argv; absent otherwise |
| 2 | Disabled setting → `skippedReason` set, exit `0`, zero scan calls |
| 3 | Unreadable/missing settings → treated as disabled, reason recorded |
| 4 | Scope is `DEFAULT_CATEGORIES` only — opt-in/unverified/custom ids are never requested |
| 5 | Unelevated → admin-required categories become `skipped` with `requires elevation` |
| 6 | Exit code mapping: all clean → 0, any failed/skipped → 1, fatal → 2 |
| 7 | Report filename is ISO-8601 and unique; rotation keeps the newest 30 |
| 8 | `totals.reclaimedBytes` is `null` when no category measured (never 0) |
| 9 | Frequency → trigger mapping (daily/weekly/monthly) |
| 10 | Portable detection refuses registration with the portable reason |
| 11 | Unpackaged build refuses registration |
| 12 | Registration success requires a re-query confirming the task exists |
| 13 | `getScheduledTaskState` query failure returns `null`, not `registered: false` |
| 14 | Disable path reverts the setting when unregistration fails |

## 8. Windows acceptance script (owner)

1. Install 1.1.0, enable scheduled cleaning (weekly). Confirm Settings shows a **real** next run time
   matching `Get-ScheduledTaskInfo -TaskName 'DeskKlean\ScheduledClean'`.
2. `Get-ScheduledTask -TaskName 'DeskKlean\ScheduledClean'` → action is the installed exe with
   `--scheduled-clean`, run level as reported by the app.
3. Run the task manually: `Start-ScheduledTask -TaskName 'DeskKlean\ScheduledClean'`. Confirm **no
   window appears**, and a new JSON report exists in `%APPDATA%\deskklean\scheduled-reports\`.
4. Open the report: real category outcomes, real byte totals, no invented values. Exit code visible
   via `Get-ScheduledTaskInfo` `LastTaskResult`.
5. Disable scheduled cleaning → task is gone from `Get-ScheduledTask`; toggle stays off.
6. Re-enable, then run the **portable** build → toggle disabled with the portable reason.
7. Run unelevated (non-admin user or normal task) → admin-required categories appear as `skipped`
   with `requires elevation`, and the run does not claim they were cleaned.
8. Corrupt `settings.json` → task run exits 0 with `settings unreadable`, deletes nothing.

## 9. Open questions

| # | Question | Blocks? |
|---|---|---|
| OQ-SCH-1 | Does `-RunLevel Highest` require an admin *session*, or only an admin *account* at registration time? | No — fall back and report (see §4.1). |
| OQ-SCH-2 | Should a missed run (`StartWhenAvailable`) be reported in the UI as "ran late"? | No — v2; the report file already carries real timestamps. |
| OQ-SCH-3 | Retention: 30 reports is arbitrary. Disk cost is ~5 KB each. | No — recommend 30. |
| OQ-SCH-4 | Should `--scheduled-clean` support `--dry-run` for the acceptance script? | **Yes** — recommend adding it; it makes step 3 verifiable without deleting anything. |
| OQ-SCH-5 | Does the NSIS uninstaller remove the scheduled task? | No — must be verified. If not, add `Unregister-ScheduledTask` to the uninstall path or document the leftover. |
