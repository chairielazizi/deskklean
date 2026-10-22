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
