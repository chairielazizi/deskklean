# DeskKlean — Planned Next Release Analysis

Date prepared: 2026-10-23
Baseline: DeskKlean v1.0.0
Reference product: CCleaner Pro

This document converts the current audit findings into a release-planning record. It is intended to decide whether the next release should be treated as a **patch**, **minor**, or **major** release.

---

## 1. Release decision summary

DeskKlean is already at **v1.0.0**. The original roadmap states that v1.0.0 means every core module is real, and all twelve core modules now have real system integrations. Therefore, the next release is no longer a “retire the mocks” milestone. It is a **post-v1.0.0 feature and honesty cleanup milestone**.

Recommended decision:

- Treat the next release as either:
  - **1.0.1** patch for cleanup and honesty fixes, or
  - **1.1.0** minor for the first backward-compatible feature bundle.
- Do **not** call the next release 2.0.0 unless it includes a breaking settings/data contract, a new destructive workflow, or a major architecture change.
- Reserve **2.0.0** for i18n, firmware-level full-drive erasure, browser privacy-data cleaning, registry medium-risk categories, and any settings-schema migration.

Under the project’s documented versioning rule:

- Patch = fix
- Minor = a module becomes real
- Major = breaking change to stored data or settings shape

At this stage, the best mapping is:

- **Patch**: bug fixes, honesty fixes, documentation fixes, safe cleanup
- **Minor**: new backward-compatible capabilities
- **Major**: breaking changes, unsafe/pervasive new workflows, schema migration or major architecture change

---

## 2. What is already complete at v1.0.0

Per `docs/ROADMAP.md` and current source inspection, the following are real:

- SystemInfo
- StartupOptimizer
- Elevation
- Settings
- Window controls
- Registry backup
- HealthCheck as aggregator
- SmartClean scan + execute through framework
- RegistryFixer scan + fix through framework
- DiskAnalyzer
- DuplicateFinder scan + delete
- AppRemover
- ExtensionManager read-only multi-profile enumeration + deep links
- SecureErase file shredder + free-space wiper
- CI/CD and packaging/release pipeline

The shared destructive-operation framework is implemented with these action kinds:

- `delete-file`
- `delete-tree`
- `overwrite-file`
- `registry-value`
- `registry-key`
- `scheduled-task`
- `uninstall`

---

## 3. Not yet implemented, deferred, held, or partially wired items

The following items are found in the docs or in the gap between docs and implementation.

### 3.1 Auto-update backend

**Status:** documented, not implemented.

**Docs:**
- `docs/DESIGN-DECISIONS.md` Q5: auto-update is intended to use `electron-updater + GitHub Releases`.
- `docs/DESIGN-DECISIONS.md` Q18: Settings should support a stable + beta update channel.
- `docs/RELEASE-NOTES.md`: lists “No auto-updater yet”.

**Current code:**
- `AppSettings.autoCheckUpdates` exists.
- No `electron-updater` usage found.
- No update-channel setting exists.
- Settings UI has an “auto check updates” toggle, but no runtime updater integration.

**Assessment:**
- Feature gap, not safety-critical.
- Suitable for a patch planning note or minor implementation.
- Requires care around signing, release artifact naming, rollback, and update-channel persistence.

### 3.2 Scheduled cleaning backend

**Status:** UI exists, engine missing.

**Docs:**
- Design says scheduled cleaning rides Windows Task Scheduler.
- The design deliberately avoids a background service.

**Current code:**
- `Settings.tsx` exposes scheduled cleaning enable/disable and frequency.
- `AppSettings.scheduledCleanEnabled` and `AppSettings.scheduledCleanFrequency` exist.
- No main-process Task Scheduler integration was found.
- No IPC handler for scheduled cleaning was found.
- Settings are persisted but not consumed by cleaner logic.

**Assessment:**
- This is an UI-only feature today.
- Either implement Task Scheduler integration honestly or remove/disable the toggle until implemented.
- Estimated scope: medium.
- Classification: minor if implemented with backward-compatible defaults.

### 3.3 Custom clean rules backend

**Status:** UI exists, engine missing.

**Docs:**
- Design Q8b: SmartClean should support built-in rules plus user-defined custom rules using paths/patterns.

**Current code:**
- `CustomCleanRule` exists.
- Settings has `customRules`.
- `Settings.tsx` supports adding and removing rules.
- SmartClean category list is fixed in `src/main/system/smartclean/categories.ts`.
- No usage of `customRules` was found in `src/main`.
- SmartClean does not scan custom rules.

**Assessment:**
- Documented user-facing feature is not wired.
- Implementation must reuse protected-path checks and report custom results separately.
- Classification: minor.

### 3.4 AppRemover post-uninstall leftover scanner

**Status:** type field exists, implementation not present.

**Docs:**
- Design Q8e: App Remover should perform standard uninstaller plus post-uninstall leftover scanning.
- Phase docs state `leftoversDetected` is a placeholder.

**Current code:**
- `InstalledApp.leftoversDetected: number; // always 0 in Phase 12 — not implemented`.
- `AppUninstallResult.leftoversCleanedCount` exists.
- Implementation sets both to 0.
- `deepCleanLeftovers` is accepted but no detection logic exists.

**Assessment:**
- Safe initial scope should be detection plus user-guided cleanup, not automatic silent deletion.
- Classification: minor if additive, major if contract changes.

### 3.5 Secure Erase: full-drive / firmware-level erasure not in v1

**Status:** explicitly deferred.

**Docs:**
- Design Q12b calls for drive-type detection:
  - SSD: ATA Secure Erase / NVMe Format
  - HDD: overwrite passes
- Roadmap D-R2-3: SecureErase is option (b): files and free-space wipe only; no full-drive erase in v1.
- Phase 14 docs state full-drive erase is out of scope for v1.

**Current code:**
- SecureErase supports file shredding and free-space wiping.
- `isTargetSsd` exists in API contract.
- Full-drive erase is not implemented.

**Assessment:**
- This is a major scope change, not a minor add-on.
- It requires elevation, irreversible confirmation, device detection, and strong error reporting.
- Classification: major.

### 3.6 RegistryFixer file-association category held

**Status:** explicitly held pending verification.

**Docs:**
- Roadmap D-R2-2: RegistryFixer uses conservative option (a).
- File associations to missing targets are held pending verification of `UserChoice` hash protection.
- Phase 7–8 docs keep the category held until OQ-1 is resolved.

**Current code:**
- `RegistryFixerIssueType` only supports:
  - `orphaned_uninstall`
  - `stale_mui_cache`
- No file-association issue type.
- All issues are `severity: 'low'`, although design mentions a possible medium-risk confirmation flow.

**Assessment:**
- Correct to keep held.
- Adding it requires proof that rewriting `UserChoice` is safe on the target Windows builds.
- Classification: major or carefully scoped minor depending on impact.

### 3.7 ExtensionManager toggle/remove intentionally deleted

**Status:** deliberate non-feature, not a pending implementation.

**Docs:**
- Roadmap D-R2-7: ExtensionManager is read-only.
- `EXTENSIONS_TOGGLE` and `EXTENSIONS_REMOVE` are deleted.
- Reason: Chromium HMAC/Secure Preferences and Firefox profile regeneration make unsafe edits possible.

**Current code:**
- Extensions are enumerated and deep-linked only.
- API contract has no toggle or remove methods.

**Assessment:**
- This should remain absent unless a supported mechanism is found.
- Browser extension management should not be added by corrupting browser profile files.
- Implementing it properly would likely require a separate browser extension or major architectural design.
- Classification: major if attempted.

### 3.8 Browser cache cleaning excluded in v1

**Status:** explicitly deferred.

**Docs:**
- Roadmap D-R2-9: browser caches are skipped in v1 because paths are version-dependent and unverified.
- Design Q17 excludes DNS cache.
- The reference product includes browser cache cleaning, DNS cache, crash dumps, history/session/form-data cleaning.

**Current code:**
- SmartClean does not clean Chrome, Edge, Firefox, or Brave browser caches.
- Font cache path is also documented as unverified.

**Assessment:**
- This is a major CCleaner-Pro parity gap.
- It should become read-only scan categories first, then optional execution.
- Classification: minor for scan-only, major for execution of browser data cleanup.

### 3.9 Duplicate Finder `name-size` matching not implemented

**Status:** contract exists, behavior not implemented.

**Docs:**
- Phase 10–11 docs state `matchBy: 'name-size'` is not implemented.
- UI should not offer it.

**Current code:**
- `DuplicateScanConfig.matchBy` supports `'hash' | 'name-size'`.
- Implementation behavior is hash-focused.
- The docs warn against offering this without adequate false-positive handling.

**Assessment:**
- Optional higher-risk matching mode.
- Classification: minor only after safe UI and confidence handling are defined.

### 3.10 Duplicate Finder image preview before delete

**Status:** stated in design, not implemented.

**Docs:**
- Design Q8g: Duplicate Finder should include hash-based detection plus image preview before delete.

**Current code:**
- No image-preview field or logic was found in the duplicate finder implementation.

**Assessment:**
- Relatively low-risk UX improvement.
- Classification: minor.

### 3.11 Disk Analyzer category mapping not user-customizable

**Status:** defer by decision.

**Docs:**
- OQ-10: extension-to-category mapping is fixed in code for v1.
- Roadmap says customizability is a likely v2 candidate.

**Current code:**
- `disk-analyzer/categorize.ts` uses fixed mapping.

**Assessment:**
- Enhancement, not a bug.
- Classification: minor.

### 3.12 Invented defaults and optimistic health status

**Status:** known residual issue.

**Docs:**
- `docs/SYSTEM-DATA-PHASES.md` lists two residual one-liners:
  - `fileSystem: ld.FileSystem || 'NTFS'` uses an invented default.
  - `healthStatus` defaults to `'good'` when unavailable.

**Impact:**
- Small honesty defects.
- Should be fixed without changing external contracts.
- Classification: patch.

### 3.13 Values intentionally returned as null

**Status:** documented and acceptable.

**Docs:**
- Several hardware values are `null` because no vendor-neutral source exists:
  - GPU usage percent
  - GPU temp
  - GPU VRAM above 32-bit field limits
  - CPU temperature when ACPI thermal zones unavailable
  - Network link speed
  - BIOS date
  - CPU speed

**Assessment:**
- These are correct “read-only paths return real data or null” behavior.
- Any vendor-specific improvement should be additive and degrade honestly to null.
- Classification: patch/minor depending on scope.

### 3.14 Auto-elevation packaging manifest option

**Status:** packaging alternative, not implemented.

**Docs:**
- Phase 2 notes that a `requireAdministrator` manifest is a packaging-time alternative, not implemented in the phase.

**Current code:**
- Runtime UAC relaunch is used.
- Electron Builder is configured as `asInvoker`.

**Assessment:**
- This is an architecture/security decision, not cleanup.
- Better deferred to a major security-model review.

### 3.15 App icon and tray icon placeholders

**Status:** known product limitation.

**Docs:**
- Design Q23: app icon is placeholder for v0.1.
- Tray implementation uses a small embedded placeholder PNG.

**Assessment:**
- Product polish, not functional feature.
- Should be resolved before a heavily marketed release.
- Classification: patch for icon replacement.

### 3.16 Secure Erase pass-count policy inconsistency

**Status:** docs and constants disagree.

**Docs:**
- Phase 14 says:
  - Default 1 pass
  - Configurable 1–3
  - Gutmann 35-pass excluded
  - Quick 1-pass + DoD 3-pass are appropriate

**Current code:**
- `SHRED_METHODS` includes `zero_1`, `dod_3`, `dod_7`, and `gutmann_35`.
- `ShredOptions.passes` is typed as `1–3`.
- UI exposes 35-pass behavior that design says should not be offered.

**Assessment:**
- This is not a user safety-neutral inconsistency.
- Offering Gutmann implies security value that the docs state it does not provide.
- Either:
  - remove DoD 7 and Gutmann methods, or
  - update design decision deliberately and document why.

**Classification:** patch if alignment only; minor if new policy introduced.

### 3.17 English-only and dark-only by design

**Status:** deliberate v1 decision, not missing implementation.

**Docs:**
- Q16: English only at launch; i18n deferred.
- Q7: dark only; light mode later.

**Current code:**
- Theme supports only dark variants.
- No localization framework.

**Assessment:**
- English-only and dark-only are accepted v1 decisions.
- Light mode can be minor, but i18n should be treated as major due scope.

### 3.18 Code signing still unresolved

**Status:** deliberate deferral.

**Docs:**
- Q9: self-signed initially; EV deferred.
- Release notes: unsigned binary causes SmartScreen warning.

**Assessment:**
- Signing is a release/distribution decision, not a feature.
- It affects updater trust and public release readiness.

### 3.19 Test scripts location inconsistency

**Status:** documentation references scripts that are not visible in current tree.

**Docs:**
- Phase docs and CI reference `scripts/test-*.mjs`.
- Architecture says there are 11 suites / 958 tests.

**Current code observations:**
- No top-level `scripts` directory was found in the same layout.
- CI still references `scripts/test-*.mjs`.

**Assessment:**
- This appears either stale documentation or an incomplete checkout artifact.
- Should be verified before release.
- Classification: documentation patch.

---

## 4. CCleaner Pro parity gaps

Based on `docs/REA_ANALYSIS.md`, CCleaner Pro feature areas not yet covered by DeskKlean include:

1. Browser cache cleaning
2. Browser history cleaning
3. Cookie cleaning
4. Session cleaning
5. Download history cleaning
6. Form data cleaning
7. Clipboard cleaning
8. DNS cache cleaning
9. Crash dump cleaning (docs conflict: SmartClean categories include crash dumps, while design Q17 says excluded)
10. Browser integration / scheduled auto-clean patterns
11. File recovery tool
12. Drive wiper as a broader tool category
13. Browser plugin management, which DeskKlean deliberately excludes for safety reasons

### Recommendation on CCleaner parity

DeskKlean should **not** copy all CCleaner Pro destructive categories automatically. Its stated design philosophy is safety-first and honesty-first. Some CCleaner-style features conflict with DeskKlean’s documented protections, especially:

- browser profile writes
- DNS cache
- prefetch deletion
- installer/temp destructive behavior
- broad browser data deletion

A good policy is:

- **Mirror safe, verifiable categories** (caches, thumbnails, temp, WER, WU logs).
- **Hold or exclude unsafe categories** (browser profiles, DNS cache, registry file association).
- **Implement browser-data cleaning only in a major release** with explicit consent and profile safety checks.

---

## 5. Suggested patch release: 1.0.1

Suggested scope: low risk, contract-stable fixes only.

Include:

1. Fix invented defaults:
   - `fileSystem` should be nullable instead of defaulting to `NTFS`.
   - `healthStatus` should remain neutral/default when unavailable instead of `'good'`.
2. Reconcile Secure Erase method list with Phase 14 design:
   - Decide whether `dod_7` and `gutmann_35` should be removed.
   - If retained, update docs with explicit rationale.
3. Replace placeholder app icon and tray icon.
4. Fix documentation/test references to `scripts/`.
5. Verify `leftoversDetected` remains `0` only when scan actually completed; use null for failed scans if needed.
6. Update release notes and known-limitations wording.
7. Do not add new major user-facing features.

This release should be **patch** level.

---

## 6. Suggested minor release: 1.1.0

Suggested scope: backward-compatible feature additions and safe new capabilities.

Include:

1. Auto-update backend with stable channel first.
2. Optional beta channel only after stable channel works end-to-end.
3. Custom clean rules wired into SmartClean, behind protected-path checks.
4. Scheduled cleaning via Windows Task Scheduler, with honest next-run reporting and default-off behavior.
5. AppRemover leftover detection as guided/read-only detection first.
6. Duplicate Finder image preview.
7. Duplicate Finder `name-size` mode only if confidence and false-positive handling are defined.
8. Light mode, preserving dark default.
9. Read-only browser cache categories after path verification.
10. Vendor-specific GPU/CPU telemetry improvements with honest null fallback.
11. Disk Analyzer category mapping remains fixed in code; customizability stays deferred.

Important release rule for minor:

- All new settings must have safe defaults.
- Old `settings.json` must still load.
- No IPC contract breakage.
- No settings-schema migration unless major.

This release should be **minor**.

---

## 7. Suggested major release: 2.0.0

Suggested scope: substantial, breaking, or high-risk changes.

Include only when ready:

1. Firmware-level Secure Erase:
   - SSD ATA Secure Erase
   - NVMe Format
   - HDD whole-drive overwrite
2. Browser privacy-data cleaning:
   - caches, cookies, histories, sessions, form data
   - explicit consent
   - profile locking detection
   - browser vendor/version/path validation
3. RegistryFixer file-association category:
   - only after `UserChoice` hash behavior is verified
4. RegistryFixer medium-risk actions:
   - explicit user confirmation
   - potentially new severity/contract fields
5. Browser extension management:
   - only if based on supported vendor APIs
   - may require shipping a companion browser extension
6. Internationalization:
   - English-only decision lifted
   - localization framework
7. Settings-schema migration layer:
   - needed before broad breaking settings changes
8. New destructive modules or larger modules:
   - file recovery
   - developer cache tools
   - advanced safety tools
9. CLI/headless mode or any service model change:
   - conflicts with current on-demand design should be explicit

This release should be **major** because it changes user expectations, destructive scope, data contracts, or runtime architecture.

---

## 8. New feature ideas to add beyond docs

These are recommendations that fit DeskKlean’s safety-first identity better than direct CCleaner cloning:

1. Restore-point-aware cleanup
   - Create or detect a Windows restore point before risky batch operations, clearly labeled as available/unsupported.

2. Undo-last-operation workflow
   - Use registry backups, startup backups, and operation plans for one-click rollback.

3. Perceptual image duplicate detection
   - Label as likely matches; do not auto-delete.

4. Developer cache presets
   - npm, pnpm, pip, Maven, Gradle, Docker tools, with explicit paths.

5. Game launcher cache presets
   - Steam, Epic Games Store, Battle.net caches, only after path verification.

6. Empty folder finder
   - Easy to verify, low-risk, protected paths enforced.

7. Large and old file assistant
   - User-reviewed suggestions, no automatic deletion.

8. Clean report export
   - Read-only JSON/HTML summary of planned and executed operations.

9. Scheduled scan-only notifications
   - Safer default than scheduled deletion.

10. Signature-aware cleanup
    - Avoid deleting files related to protected products.

11. Settings export/import
    - Useful with custom rules and exclusions.

12. Browser extension inventory export
    - Read-only security review aid.

---

## 9. Decision rules for implementation

Use these rules when assigning future work:

- If a change only fixes correctness without touching contracts, it is a **patch**.
- If a change adds a capability while old settings and APIs still work, it is a **minor**.
- If a change adds a destructive behavior, requires migration, changes registry/profile safety assumptions, or changes settings schema, it is a **major**.
- If a feature cannot be verified on the target Windows machine, it remains **held**, not implemented.
- If a UI toggle exists without backend implementation, either implement it or mark it clearly unavailable in the UI.
- If docs and code disagree, stop and reconcile before adding the next feature.

---

## 10. Final recommendation

- Start with **1.0.1** to fix honesty and consistency defects.
- Follow with **1.1.0** to implement the already-documented but unwired features:
  - auto-update
  - custom clean rules
  - scheduled Task Scheduler cleaning
  - guided leftovers detection
  - light mode and preview features
- Hold **2.0.0** for:
  - firmware-level full-drive erasure
  - browser privacy-data cleaning
  - file-association registry category
  - i18n
  - breaking settings migration

This gives DeskKlean a credible post-v1.0.0 roadmap without risking users or undermining the honesty principle that defines the project.