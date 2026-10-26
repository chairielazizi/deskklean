# Phase 19 — AppRemover Leftover Detection (read-only, user-guided)

**Status:** 🔜 specified, not built
**Depends on:** Phase 3 (framework) ✅ · Phase 12 (AppRemover) ✅
**Classification:** minor (additive field + new capability, no contract break)
**Design refs:** DESIGN-DECISIONS Q8e (standard uninstaller + post-uninstall leftover scanner), D-R2-4 (deletion semantics), D-R2-5 (verify removal)

---

## Goal

Make the App Remover's leftover story real, in the order that cannot destroy anything: **detect
first, delete only on explicit user selection.**

Today, after v1.0.1:

- `InstalledApp.leftoversDetected` is `null` for every app (`appRemover.ts:483`, `:513`) — honest, but
  permanent.
- `AppUninstallResult.leftoversCleanedCount` exists and is always `0`.
- `APPS_UNINSTALL` accepts a `deepCleanLeftovers` argument (`ipc.ts:1056`) that **no code reads**.

So the UI implies a leftover scan that does not exist, and an argument that does nothing. This phase
replaces both with a real detection pass and a user-selected cleanup.

## 1. Scope decision — detection only, then guided cleanup

Q8e asks for "standard uninstaller + post-uninstall leftover scanner (files, folders, registry
remnants)". This phase ships it in two halves:

1. **Detection** (this phase's core): after a verified uninstall, enumerate candidate leftovers, with
   real measured sizes and a confidence label. `leftoversDetected` becomes a real count.
2. **Cleanup** (this phase, gated): the user selects candidates; a plan is built through the existing
   framework and executed with backups. `leftoversCleanedCount` becomes real.

**Never automatic.** No `deepCleanLeftovers: true` path that deletes without a per-item confirmation.
Heuristic matching plus unattended deletion is how a cleaner deletes a user's project folder because
it shared a name with an uninstalled app.

## 2. New module — `src/main/system/leftovers.ts`

### 2.1 Types

```ts
export type LeftoverConfidence = 'high' | 'medium';

export interface LeftoverCandidate {
  id: string;
  kind: 'file' | 'directory' | 'registry-key';
  path: string;                 // absolute path or full registry path
  sizeBytes: number | null;     // measured; null when unmeasurable — never 0 as a stand-in
  confidence: LeftoverConfidence;
  reason: string;               // why it was matched — shown verbatim to the user
  selectableByDefault: boolean; // true only for confidence 'high'
}

export interface LeftoverScanResult {
  appId: string;
  appName: string;
  scanned: boolean;             // false when the scan could not run
  failureReason: string | null; // required when scanned is false
  candidates: LeftoverCandidate[];
  detectedCount: number | null; // null when scanned is false — NEVER 0
  totalBytes: number | null;
}
```

### 2.2 Candidate sources

| Source | Match rule | Confidence |
|---|---|---|
| Install directory remnant | `app.installLocation` non-empty, directory still exists after verification | `high` |
| `%LOCALAPPDATA%\<Name>` / `%APPDATA%\<Name>` / `%PROGRAMDATA%\<Name>` | normalized exact match on `app.name` or `app.publisher` | `high` |
| `%LOCALAPPDATA%\Programs\<Name>` | normalized exact match | `high` |
| Same roots, **contains** match on name/publisher | substring match, case-insensitive | `medium` |
| Registry `HKCU\Software\<Name>`, `HKLM\Software\<Name>`, `HKLM\Software\WOW6432Node\<Name>` | normalized exact match | `high` |
| Registry roots, contains match | substring | `medium` |

Normalization: lowercase, trim, collapse whitespace, strip `(x86)`, strip a trailing version token
(`1.2.3`), strip trailing `Ltd`/`Inc`/`LLC`/`Sdn Bhd` style suffixes. Implement as a pure function so
it is testable.

### 2.3 Mandatory exclusions (a candidate must fail all of these)

1. **Protected paths** — `validatePath` from `framework/protected.ts` must accept it.
2. **Shared/ambiguous roots** — the roots themselves (`%APPDATA%`, `%LOCALAPPDATA%`, `%PROGRAMDATA%`,
   `%LOCALAPPDATA%\Programs`, `Software`, `Software\WOW6432Node`) are never candidates, only their
   children.
3. **Another installed app's territory** — cross-check every candidate against
   `getAllInstalledApps()`: if another installed app's `installLocation` or normalized name matches
   the candidate, drop it and record why. This is the single most important guard: uninstalling
   "Acme Tool" must not offer to delete "Acme Suite".
4. **Known-shared data directories** — `%LOCALAPPDATA%\Temp`, `%APPDATA%\Microsoft`,
   `%LOCALAPPDATA%\Microsoft`, `%PROGRAMDATA%\Microsoft`, `%APPDATA%\Packages` children owned by
   Store apps.
5. **Empty match** — a normalized name shorter than 3 characters produces no candidates at all
   (a two-letter app name substring-matches half the disk).

### 2.4 Functions

| Function | Contract |
|---|---|
| `normalizeAppToken(s)` | Pure. Lowercase/trim/collapse/strip suffix as §2.2. |
| `buildLeftoverCandidates(app, env, opts)` | Pure candidate-path generation from the app record + env. No filesystem access — testable on Linux. |
| `filterLeftoverCandidates(candidates, installedApps, opts)` | Pure exclusion pass (§2.3 items 1–5, minus the real `stat`). |
| `scanLeftovers(app, opts)` | Stats surviving candidates, measures real sizes, returns `LeftoverScanResult`. Never throws: on failure returns `scanned: false` with `failureReason` and `detectedCount: null`. |
| `createLeftoverCleanupPlan(result, selectedIds)` | Builds an `OperationPlan`: `delete-tree`/`delete-file` for paths, `registry-key` for keys. Every path through `validatePath`; every registry key through `validateRegistryPath`. Reversibility: files → `reversible` (Recycle Bin, D-R2-4); registry keys → `reversible` only when the `.reg` backup is written, otherwise declared `irreversible` with a reason. |

## 3. Integration with the uninstall flow

`AppUninstallResult` gains **one optional additive field**:

```ts
leftovers?: LeftoverScanResult;   // present only when a scan actually ran
```

Rules:

- Detection runs **only after** `verified: true` (D-R2-5: never report success without confirming the
  product is gone). Scanning leftovers of an app that is still installed produces noise and risks
  pointing at live files.
- `leftoversDetected` on `InstalledApp` becomes a real count **only** when a scan completed; it stays
  `null` otherwise. The type stays `number | null`.
- `leftoversCleanedCount` becomes real only after an executed cleanup plan. Until then it is `0`.
- **`deepCleanLeftovers` is deleted, not implemented.** It is an argument no code reads and its name
  promises unattended deletion. Replacing it with an explicit two-step (detect → user selects →
  cleanup) is the honest shape. If the renderer passes it, the handler ignores it and the renderer is
  updated in the same commit.

## 4. IPC

```ts
APPS_SCAN_LEFTOVERS: 'apps:scanLeftovers',   // (appId) => LeftoverScanResult
APPS_CLEAN_LEFTOVERS: 'apps:cleanLeftovers', // (appId, candidateIds[]) => ExecuteResult + counts
```

`APPS_CLEAN_LEFTOVERS` refuses an empty selection, refuses ids not present in a fresh scan, and
returns the framework's `ExecuteResult` with `completed`/`failed`/`skipped` kept separate.

## 5. Renderer (App Remover)

- After a successful uninstall with leftovers found: *"N leftovers found (X MB). Review"* — a button,
  not an automatic action.
- Review panel: each candidate with path, measured size, confidence badge, and the `reason` string.
  Only `high` candidates are pre-selected; `medium` ones require an individual click.
- A `medium` candidate carries a visible warning: *"Name matches only — verify this is not another
  application's data."*
- Cleanup result reports partial outcomes honestly: *"12 of 15 removed, 2 in use, 1 failed."*
- If the scan failed, the panel says so with the reason. It never shows "0 leftovers".

## 6. Tests — `scripts/test-leftovers.mjs` (new, pure logic)

| # | Test |
|---|---|
| 1 | `normalizeAppToken` strips `(x86)`, version tokens, and company suffixes |
| 2 | Candidate generation covers install dir + the five env roots + three registry roots |
| 3 | Protected path candidate is dropped |
| 4 | Root itself (`%APPDATA%`) is never a candidate |
| 5 | Candidate owned by another installed app is dropped, with a reason |
| 6 | `%LOCALAPPDATA%\Temp` and the Microsoft roots are dropped |
| 7 | Name shorter than 3 chars produces zero candidates |
| 8 | Exact match → `high` + `selectableByDefault: true`; contains match → `medium` + `false` |
| 9 | Scan failure → `scanned: false`, `detectedCount: null`, `failureReason` set (never 0) |
| 10 | `leftoversDetected` stays `null` when no scan ran |
| 11 | Cleanup plan: files carry Recycle Bin metadata; registry keys carry a `.reg` backup |
| 12 | Cleanup plan refuses a candidate id absent from the fresh scan |
| 13 | Empty selection is refused with a reason |
| 14 | Unmeasured candidate keeps `sizeBytes: null` and is excluded from `totalBytes` sum |

## 7. Windows acceptance script (owner)

1. Uninstall an app you can reinstall (e.g. a small portable-ish tool that leaves `%APPDATA%` data).
2. After the uninstall verifies, the App Remover reports **N leftovers found** with real sizes.
3. Confirm no candidate points at another installed app's directory.
4. Select the `high` candidates, clean → files land in the **Recycle Bin**; registry keys are removed
   with a `.reg` backup present in the backup store.
5. Restore from the Recycle Bin and from the `.reg` backup → state returns.
6. Kill the scan path (e.g. deny access to `%APPDATA%`) → result says the scan failed, and the UI does
   **not** say "0 leftovers".
7. Confirm `deepCleanLeftovers` no longer exists in the IPC contract and the renderer no longer sends it.

## 8. Open questions

| # | Question | Blocks? |
|---|---|---|
| OQ-LO-1 | Should Store (MSIX) apps get leftover detection? Their data lives in `%LOCALAPPDATA%\Packages\<PackageFamilyName>`, which is a reliable exact key. | No — recommend including it in 1.1.0 since the key is exact, not heuristic. |
| OQ-LO-2 | Should the scan run automatically after every uninstall, or only on request? | No — recommend automatic detection (read-only, cheap) + user-initiated cleanup. |
| OQ-LO-3 | Do we need a "leftovers older than N days" filter to avoid flagging recently-written files? | No — v2. Recency is not evidence of ownership either way. |
| OQ-LO-4 | Should `medium` candidates ever be bulk-selectable? | **No.** Recommend never; bulk selection of substring matches is the false-positive path. |
| OQ-LO-5 | What happens when two uninstalls leave the same candidate? | No — the second scan simply re-detects it; cleanup is idempotent because missing paths report as `skipped`. |
