# Phase 4 — Health Check

**Status:** 🔜 specified, not built
**Depends on:** Phase 0 (system bridge) ✅ · Phase 1 (System Info) ✅ · Phase 2 (Startup Optimizer) ✅

## Goal

Replace the current Health Check — which invents a score of 74, returns a hardcoded list of issues, and whose `HEALTH_FIX` reports freeing 4.89 GB it never freed — with a **pure aggregator** (decision D-R2-6). It owns no scan logic of its own. It invokes the other modules' real scans and combines their results into a health report.

Every number shown must be traceable to a measurement a constituent module actually returned. A number that cannot be traced is not shown.

## Why this phase is different

The current Health Check is the worst offender in the project's honesty ledger. It fabricates a numeric score, fabricates issues, and its fix handler reports reclaiming disk space it never touched. That is the same class of defect as `WIPE_FREE_SPACE` reporting a 10 GB wipe that never happened — a success claim for work not performed.

An independent scanner would also eventually contradict the module the user clicks into. If Health Check says "Startup Optimizer has 12 items" but Startup Optimizer says 10, the user has no way to know which is right, and neither module can explain the discrepancy. Aggregation eliminates that entire class of bug: there is one scanner per concern, and Health Check only adds presentation.

---

## Resolved decisions

### D4-1 — Aggregator only ✅

**HealthCheck owns no filesystem, registry, or WMI enumeration.** It calls the scan APIs that the other modules already expose (or will expose) and combines their results. It does not maintain its own list of paths to check, its own issue vocabulary, or its own thresholds for what constitutes a problem.

Concretely, Health Check invokes:

| Constituent module | What Health Check calls | What it gets back |
|---|---|---|
| SmartClean (Phase 5) | the scan API | per-category byte totals, per-category file counts |
| SystemInfo (Phase 1) | disk free-space queries | total bytes, free bytes, free-percentage per volume |
| Startup Optimizer (Phase 2) | the startup-items API | item count, measured boot-impact totals |
| DiskAnalyzer (Phase 9, when built) | volume-level breakdown | per-volume used/free |

If a constituent module does not yet exist, Health Check reports that section as **"not measured"** rather than substituting a placeholder. A module that is built later automatically enriches the Health Check report without Health Check being rewritten.

### D4-2 — Score derivation ✅

The health score is derived from real measurements only. It is not a weighted formula applied to invented inputs.

**Disk pressure** is the only component Health Check can compute at launch, because SystemInfo (Phase 1) is already real. Once SmartClean (Phase 5) lands, reclaimable-junk bytes become a second real component.

```
diskPressure = (1 - freeBytes / totalBytes) * 100    // SystemInfo measurement
reclaimableRatio = reclaimableBytes / totalBytes     // SmartClean measurement, 0 if not yet built
```

The score starts at 100 and loses points for each pressure component:

| Component | Points lost | Trigger |
|---|---|---|
| Disk pressure | up to 40 | proportional to `diskPressure` above 70% |
| Reclaimable junk | up to 30 | proportional to `reclaimableRatio` above 5% |
| Startup impact | up to 20 | proportional to measured boot-degradation seconds above 5 s |
| Startup count | up to 10 | proportional to enabled-item count above 20 |

Each component contributes **zero** when its underlying measurement is absent. A missing SmartClean module means the reclaimable-junk component contributes 0, and the maximum possible score is 70 — not because the system is unhealthy, but because part of the picture is unmeasured. The UI states which components contributed and which were not measured.

**Rails:**

- The score is `null`, not a number, when **zero** components have real measurements. A score of 0 looks like a broken system; `null` with an explanation looks like an honest tool.
- The formula and thresholds are versioned. If they change, the version is recorded in the activity log so a score change can be attributed to a formula change or a measurement change.

### D4-3 — Every number is traceable ✅

Every numeric value in the Health Check UI must be either:

1. A direct measurement a constituent module returned, or
2. A simple arithmetic combination of such measurements, with the derivation shown.

No number is estimated, extrapolated, or carried over from a previous scan. If a constituent module returns `null` for a value, Health Check displays "not measured" — never a zero, never an average, never a guess.

### D4-4 — HEALTH_FIX is removed ✅

`HEALTH_FIX` reports freeing 4.89 GB it never freed. It is deleted. Health Check has no fix capability of its own. Fixing is the province of the module that identified the issue: Smart Clean cleans junk, Startup Optimizer toggles startup items. Health Check deep-links to the relevant module's UI.

### D4-5 — Partial results are reported as partial ✅

When a constituent module's scan fails or returns partial data, Health Check reports what it received and marks the rest as **"not measured"** — not as "healthy", not as "no issues". The report explicitly lists which modules succeeded, which failed, and which have not been built yet.

---

## Health Check report structure

```ts
export interface HealthReport {
  generatedAt: string;                    // ISO 8601
  score: number | null;                   // null when zero components measured
  components: HealthComponentResult[];    // one per constituent module
  unmeasured: string[];                   // names of modules not yet built
}

export interface HealthComponentResult {
  module: string;                         // 'SmartClean' | 'SystemInfo' | ...
  status: 'ok' | 'partial' | 'failed' | 'not_built';
  measurements: HealthMeasurement[];      // real values only
  issues: HealthIssue[];                  // derived from real measurements only
}

export interface HealthMeasurement {
  label: string;                          // e.g. 'Free disk space (C:)'
  value: number;                          // bytes, count, or percent — never null
  unit: 'bytes' | 'count' | 'percent';
  source: string;                         // which module returned it
}

export interface HealthIssue {
  module: string;
  severity: 'info' | 'warning' | 'critical';
  description: string;
  measurementRef: string;                 // label of the measurement that triggered it
  deepLink: string;                       // which module's UI addresses it
}
```

### Issue derivation

Issues are derived from measurements against **documented thresholds** — the same thresholds each constituent module uses in its own UI. Health Check does not invent its own threshold vocabulary.

| Issue | Triggering measurement | Threshold | Deep-links to |
|---|---|---|---|
| Disk nearly free | `Free disk space (C:)` | < 10% free | SystemInfo |
| Reclaimable junk high | `Reclaimable bytes (total)` | > 5% of disk | SmartClean |
| Boot impact high | `Total boot degradation` | > 5 s | Startup Optimizer |
| Startup items high | `Enabled startup items` | > 20 | Startup Optimizer |
| Crash dumps present | `Crash dump count` | > 0 | SmartClean (when built) |

A measurement that is absent produces no issue. No issue is invented to fill space.

---

## Contract changes

| Change | Detail |
|---|---|
| `HEALTH_GET_REPORT` | returns a `HealthReport` — the aggregated result |
| `HEALTH_FIX` | **deleted** — Health Check has no fix capability |
| `HEALTH_GET_FIXES` | **deleted** — replaced by `HEALTH_GET_REPORT` with deep links |
| Score derivation formula | recorded in the versioned config, with the version stamped into the activity log |

The renderer shows: the score (or "not yet measured" if `null`), each component's measurements, each derived issue with its source measurement and a button that navigates to the owning module, and a list of unmeasured modules.

---

## Files

```
src/main/system/health.ts        NEW  — the aggregator: calls constituent scans,
                                     combines results, derives the score
src/main/ipc.ts                 EDIT  — replace HEALTH_FIX / HEALTH_GET_FIXES
                                     with HEALTH_GET_REPORT
src/shared/types.ts             EDIT  — HealthReport / HealthComponentResult /
                                     HealthMeasurement / HealthIssue
src/renderer/.../HealthCheck.tsx EDIT  — render real measurements, issues with
                                     deep links, and unmeasured-module list
scripts/test-health.mjs          NEW  — pure-logic tests: score derivation,
                                     issue derivation, partial-failure handling
```

`health.ts` contains no filesystem access, no registry access, no WMI calls. It imports the other modules' scan functions and calls them.

---

## Implementation order

1. `health.ts` skeleton — call SystemInfo and Startup Optimizer (already real), report their measurements, leave SmartClean and DiskAnalyzer as `not_built`.
2. Score derivation — disk pressure component only, until Phase 5 lands.
3. Issue derivation — disk-pressure and startup issues only.
4. Partial-failure handling — one module failing must not empty the report.
5. Delete `HEALTH_FIX` and `HEALTH_GET_FIXES`.
6. Renderer — real measurements, issues with deep links, unmeasured-module list.
7. When Phase 5 (SmartClean) lands, add the reclaimable-junk component without rewriting the aggregator.

Steps 1–6 land in this phase. Step 7 is a small, additive change owned by the Phase 5 spec.

---

## Verification

Pure logic, runs on the build machine:

- Score derivation: known inputs → known score, with each component's contribution isolated
- Score is `null` when zero components are measured
- Issue derivation: each threshold triggers the correct issue; no measurement → no issue
- Partial failure: one module returning `failed` or `partial` does not empty the report
- Deep-link correctness: every issue's `deepLink` points to a module that exists
- No invented values: the test asserts that every `HealthMeasurement.source` matches a real module name

Windows acceptance, run by the owner:

1. `HEALTH_GET_REPORT` returns real disk-free numbers matching SystemInfo
2. Startup items count matches Startup Optimizer's count
3. SmartClean section reads `not_built` before Phase 5 lands
4. A simulated constituent-module failure produces a report that lists the failure and omits that component's measurements — it does not crash, does not report the module as healthy, and does not fabricate replacement numbers
5. `HEALTH_FIX` is absent from the IPC handler map

---

## Risks

| Risk | Mitigation |
|---|---|
| Health Check becomes a second scanner by accumulation | It calls module scan APIs; it contains no path lists, no queries, no thresholds beyond the documented issue-derivation table |
| The score formula changes silently | Formula version is stamped in the activity log |
| A module returns partial data and Health Check treats it as full | `status: 'partial'` is propagated; the UI labels it |
| Health Check reports "no issues" when a module is not built | `not_built` modules are listed explicitly; the score reflects only measured components |
| The old `HEALTH_FIX` is missed and left in the IPC map | Step 5 deletes it; the Windows acceptance test asserts its absence |
