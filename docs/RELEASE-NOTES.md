# DeskKlean v1.1.0

Minor release. No settings-schema changes. Four features that were persisted and rendered but never
implemented are now wired end to end. A v1.0.1 (or earlier) `settings.json` loads unchanged.

## What's new

### Auto-update (Phase 16)
- Stable-channel auto-update via `electron-updater` against GitHub Releases.
- Manual \"Check for updates\" in Settings; status reporting with `error` only in the `error`
  state (no invented \"up to date\" claims), plus a renderer banner guard.
- `latest.yml` / `.blockmap` consumed at runtime for differential downloads.

### Custom clean rules (Phase 17)
- User-defined `CustomCleanRule` entries in Settings now drive SmartClean's scan, plan, and
  execute paths.
- Protected-path checks enforced per run; partial results reported as `completed`/`failed`/`skipped`.

### Scheduled cleaning (Phase 18)
- Headless `--scheduled-clean` CLI entry point (no window, no tray) runnable from Windows
  Task Scheduler.
- Real register/unregister through PowerShell-backed `taskScheduler.ts`; portable builds refuse.
- Settings toggle wires to the real Task Scheduler and reverts on registration failure with the
  reason surfaced; honest next-run reporting (null when not registered).

### AppRemover leftover detection (Phase 19)
- Read-only, user-guided detection of post-uninstall leftovers (file tree + registry), with
  `scanLeftovers` returning `scanned: false` + `null` on failure (never `0`).
- Confidence tiers surfaced in the UI (high preselected, medium flagged as name-match only).
- Cleanup routes through the shared destructive framework (Recycle Bin for user data).

## Known limitations
- Unsigned binary — Windows SmartScreen warning persists until the binary builds
  reputation (no new signing decision in this release).
- Windows only.
- Scheduled cleaning requires a packaged (non-portable) Windows build; the in-app runner
  surfaces next-run where available.
- Beta update channel and browser-cache categories remain deferred to v1.2.0+.

---

# DeskKlean v1.0.1

Patch release. No new features and no settings-schema changes.

## Honesty and consistency fixes

- Removed invented free-space defaults from Secure Erase wipe planning. A wipe now refuses with an honest reason when volume size or free space cannot be measured.
- Secure Erase no longer advertises Gutmann 35-pass or 7-pass methods, matching the v1 design decision. Pass count remains 1 pass by default and 1–3 passes only.
- Secure Erase overwrite descriptions now describe cryptographic random data rather than zero-fill.
- Corrected the free-space wipe irreversibility reason to refer to wiping free space, not file shredding.
- Mock fallback system data now returns `null` instead of invented `NTFS` file-system or `good` health values.
- App Remover now reports `null` for leftovers detection instead of a misleading `0`, because leftover scanning is not implemented in v1.
- Updated affected pure-logic tests to expect the honest null values.

## Known limitations

- Unsigned binary — see the v1.0.0 SmartScreen note below
- No auto-updater yet
- Windows only

---

# DeskKlean v1.0.0

The first release of DeskKlean — a Windows system cleaner where **every module does
real work**. Nothing reports success for work it did not perform.

## Artifacts

| File | What it is |
|---|---|
| `DeskKlean Setup 1.0.0.exe` | NSIS installer (per-user, no admin prompt) |
| `DeskKlean-Portable-1.0.0.exe` | Portable single executable |

The installer installs to `%LOCALAPPDATA%\Programs\DeskKlean` and does not require
administrator rights. The portable build extracts to a temp directory at runtime.

## ⚠️ Windows SmartScreen warning (expected)

**DeskKlean is not code-signed.** Windows will show a blue *"Windows protected your
PC"* warning when you run either artifact. Click **More info** → **Run anyway** to
proceed.

This is expected, and it will keep appearing until the binary builds reputation with
Microsoft, which requires significant install volume. Buying a code-signing
certificate is an open decision for the project; it is not required to use the app.

## Modules

- **SmartClean** — category-based cleaning with per-file skip reporting
- **Duplicate Finder** — content-hash duplicate detection
- **Disk Analyzer** — per-directory size breakdown
- **App Remover** — uninstall apps and verify removal by re-enumeration
- **Secure Erase** — multi-pass overwrite with fsync
- **Extension Manager** — read-only browser extension inventory
- **Startup Optimizer** — startup delay and restore
- **Registry Fixer** — registry issue detection
- **Health Check** — system health assessment
- **System Info** — hardware and OS information

## Verification

Every module is covered by automated tests. This release was built by CI on
`windows-latest` with Node 20 after all test suites passed.

## Known limitations

- Unsigned binary — see the SmartScreen note above
- No auto-updater yet
- Windows only
