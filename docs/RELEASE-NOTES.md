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
