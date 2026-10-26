# Phase 17 — Custom Clean Rules (wired into SmartClean)

**Status:** 🔜 specified, not built
**Depends on:** Phase 3 (framework) ✅ · Phase 5/6 (SmartClean scan + execute) ✅
**Classification:** minor (new capability, no schema change)
**Design refs:** DESIGN-DECISIONS Q8b (built-in rules + user-defined rules), D-R2-4 (deletion semantics), D-R2-9 (unverified paths)

---

## Goal

Make `AppSettings.customRules` do something. Today:

- `CustomCleanRule` exists in `src/shared/types.ts:586` with `{id, name, directoryPath, filePattern, recursive, enabled}`.
- `Settings.tsx` supports adding and removing rules (`:67`, `:74`, `:277-281`).
- `DEFAULT_SETTINGS.customRules` is `[]` and **nothing in `src/main` reads the field**. Verified:
  `grep -rn customRules src/main` returns nothing.

The UI collects rules and silently discards their meaning. This phase wires them into the existing
SmartClean scan → plan → execute pipeline, so a custom rule produces a real measurement and a real,
reversible deletion.

## 1. Design position

Custom rules are **user-supplied paths**, which is the single largest safety surface in the app.
Nothing about a rule may be assumed safe because the user typed it. Therefore:

- A rule's root is validated on **every scan and every execute**, not only at save time.
- A rule may **never** resolve into the protected list (`framework/protected.ts`). Enforcement is
  central: the framework's `validatePath` already refuses protected targets at plan and execute
  time, and the rule is additionally rejected at save time for a fast, honest error.
- Rule deletions are **Recycle Bin**, always. `CustomCleanRule` targets user-chosen locations, which
  is user data by definition → `deletionMethod: 'recycle-bin'` per D-R2-4.
- A rule is **not** Microsoft-vetted. Its results must be labelled user-defined in the UI and may
  not borrow the `SAFE` verdict or a Microsoft source URL.

## 2. New module — `src/main/system/smartclean/customRules.ts`

### 2.1 Types

```ts
export type CustomRuleConfidence = 'user-defined';

export interface CustomRuleScanResult {
  ruleId: string;
  ruleName: string;
  id: string;                 // 'custom:<ruleId>' — matches the SmartCleanCategory id convention
  rootPath: string;           // fully resolved, absolute
  status: 'ok' | 'failed' | 'skipped';
  failureReason?: string;     // required when status is 'failed' or 'skipped'
  reclaimableBytes: number | null;  // null when unmeasurable — never 0 as a stand-in
  fileCount: number | null;
  files: CustomRuleFile[];    // capped, see §2.5
  skippedFiles: SkippedFile[];
  verdict: 'CONDITIONAL';     // never 'SAFE'
  source: 'user-defined rule';// never a Microsoft URL
  deletionMethod: 'recycle-bin';
  confidence: CustomRuleConfidence;
}
```

### 2.2 Functions

| Function | Contract |
|---|---|
| `validateCustomRule(rule, env)` | Returns `{ ok: true, resolvedRoot }` or `{ ok: false, reason }`. Checks: `directoryPath` non-empty; `%VAR%` expansion via the existing `resolveEnvPath` (`scan.ts:25`); result absolute; no `..` segment; not a drive root (`C:\`); not a UNC path or mapped network drive (skip with an explicit reason, consistent with RegistryFixer OQ-8); not inside the protected list; `filePattern` non-empty and free of `..` and path separators. |
| `scanCustomRule(rule, opts)` | Walks the resolved root (recursive only when `rule.recursive`), matches `filePattern` via `globToRegExp` (`scan.ts:69`), measures real bytes, collects `skippedFiles` with reasons. Returns `CustomRuleScanResult`. |
| `scanCustomRules(rules, opts)` | Runs enabled rules, never throwing: a failing rule becomes `status: 'failed'` with its reason. |
| `createCustomRulesPlan(scanResults, selectedRuleIds, opts)` | Builds an `OperationPlan` of `delete-file` actions with `deletionMethod: 'recycle-bin'` metadata, validating every path through `validatePath` first. `totalReclaimableBytes` is the sum of the scan's real measurements, or `null` if any selected rule measured `null`. |

### 2.3 Pattern semantics (deliberately narrow)

- `*` matches within a path segment; `?` matches one character. Nothing else.
- **No `**`.** Recursion is controlled by `rule.recursive`, not by the pattern — two overlapping
  recursion mechanisms is how a rule reaches somewhere the user did not intend.
- No character classes, no brace expansion, no negation.
- Case-insensitive matching (Windows filesystem semantics).
- A pattern containing `/`, `\`, or `..` is rejected at validation.

### 2.4 Protected-path and exclusion enforcement

Reuse, do not reimplement:

1. `validatePath` from `framework/protected.ts` at validation time (fast failure in Settings).
2. `validatePath` again inside `createCustomRulesPlan` for every file.
3. The framework's own check at execute time — third and final gate.

Additionally honour `AppSettings.excludedPaths` (already passed to `scanSmartClean` as
`customExcludedPaths`): a custom rule may not descend into an excluded path.

### 2.5 Scan caps and partial reporting

- Cap collected `files` at 5,000 per rule for the UI payload, but keep `reclaimableBytes` and
  `fileCount` measured over the **entire** matched set. If the cap is hit, report
  `filesTruncated: true` and state the real count.
- Reparse points (junctions/symlinks) are **never followed** — consistent with DiskAnalyzer OQ-11 and
  DuplicateFinder. Counted as skipped with reason `reparse point`.

## 3. Pipeline integration

`scanSmartClean(enabledCategoryIds, options)` currently filters `ALL_CANDIDATE_CATEGORIES`. Extend it
without changing existing behaviour:

```ts
export interface ScanSmartCleanOptions {
  env?: NodeJS.ProcessEnv;
  categories?: SmartCleanCategoryDefinition[];
  scanRootOverrides?: Record<string, string>;
  customExcludedPaths?: string[];
  customRules?: CustomCleanRule[];      // NEW — additive
}
```

- Custom results are returned on the report as a **separate array** (`report.customRules`), not merged
  into `report.categories`. They must never be summed into the default "reclaimable" headline as if
  they were vetted Windows categories — the UI shows them in their own section with their own total.
- `createSmartCleanPlan` is unchanged. Custom rules use `createCustomRulesPlan`, and the UI can offer
  both plans or one combined plan built by concatenating actions — but the two totals stay separate
  in the report and in the plan metadata (`module: 'smartclean'` vs `module: 'smartclean-custom'`).

## 4. Renderer

- Settings → Cleaning: the existing rule list gains
  - validation on save: invalid path/pattern shows an inline error and the rule is **not** persisted
  - an "off / on" toggle per rule that actually gates scanning
  - a label: *"User-defined rule — not vetted by Microsoft"*
- SmartClean results: a separate **Custom rules** section listing each rule with measured size, file
  count, skipped count and failure reason. A failed rule shows the reason, never `0 B`.

## 5. Tests — `scripts/test-custom-rules.mjs` (new, pure logic)

| # | Test |
|---|---|
| 1 | `%LOCALAPPDATA%`-style expansion resolves via `resolveEnvPath` |
| 2 | Drive root (`C:\`) is rejected |
| 3 | Path containing `..` is rejected |
| 4 | UNC path (`\\server\share`) is skipped with a network reason |
| 5 | Protected path (`C:\Windows\System32`) is rejected |
| 6 | Pattern containing `\`, `/`, or `..` is rejected |
| 7 | `*` and `?` match as specified; `**` is treated as literal-ish and rejected at validation |
| 8 | Missing root → `status: 'failed'` with reason, `reclaimableBytes: null` (never 0) |
| 9 | Unreadable file → recorded in `skippedFiles` with a reason |
| 10 | Reparse point is not followed, counted as skipped |
| 11 | `recursive: false` does not descend |
| 12 | Plan actions all carry `deletionMethod: 'recycle-bin'` and pass `validatePath` |
| 13 | `filesTruncated` is true past the cap while `fileCount` stays the real total |
| 14 | `verdict` is `CONDITIONAL` and `source` is `'user-defined rule'` — never `SAFE`/a MS URL |

Use a temp directory tree under `os.tmpdir()` for the filesystem cases, as the existing suites do.

## 6. Windows acceptance script (owner)

1. Add a rule: root `%LOCALAPPDATA%\DeskKleanRuleTest`, pattern `*.tmp`, recursive on. Create 3 dummy
   `.tmp` files and 1 `.keep` file in that folder.
2. Scan → exactly 3 files, real byte total, `.keep` untouched.
3. Try to add a rule rooted at `C:\Windows` → rejected at save with a clear reason.
4. Try to add a rule rooted at `C:\` → rejected.
5. Delete via the rule → files land in the **Recycle Bin** (verify by opening it), not permanently gone.
6. Restore them from the Recycle Bin → back in place.
7. Point a rule at a deleted folder → scan reports failure with a reason, not `0 B`.

## 7. Open questions

| # | Question | Blocks? |
|---|---|---|
| OQ-CR-1 | Should `enabled: false` rules be preserved on scan (shown greyed) or omitted entirely from the report? | No — recommended: omitted from the report, listed in Settings only. |
| OQ-CR-2 | Maximum number of custom rules (UI complexity + scan time)? | No — recommend 50, enforced at save. |
| OQ-CR-3 | Should rules support exclude patterns (e.g. `*` minus `*.keep`)? | No — v2 candidate; keeps the matcher narrow now. |
| OQ-CR-4 | Is `%USERPROFILE%\Downloads` allowed as a custom root? | **Yes, with a consequence warning.** It is excluded from *default* categories (SmartClean research), but a user explicitly targeting it is making a choice, and deletion is Recycle Bin. Must show the consequence text at save. |
