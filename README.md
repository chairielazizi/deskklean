# DeskKlean

**Modern, Honest Windows Desktop System Cleanup & Optimization**

DeskKlean is an open-source, privacy-respecting Windows utility inspired by classic desktop cleaners, engineered on one fundamental rule: **every module does real work, and nothing reports success for work it did not perform.**

DeskKlean backs up registry state before modifications, routes user files through the Recycle Bin, verifies operations by re-reading actual system state, and strictly guards core Windows paths.

---

## Downloads (v1.0.0)

Grab the latest release from the [GitHub Releases](https://github.com/chairielazizi/deskklean/releases/tag/v1.0.0) page:

| Artifact | Type | Description |
|---|---|---|
| **[`DeskKlean Setup 1.0.0.exe`](https://github.com/chairielazizi/deskklean/releases/download/v1.0.0/DeskKlean.Setup.1.0.0.exe)** | NSIS Installer | Installs per-user to `%LOCALAPPDATA%\Programs\DeskKlean`. Does not require administrative privileges to install. |
| **[`DeskKlean-Portable-1.0.0.exe`](https://github.com/chairielazizi/deskklean/releases/download/v1.0.0/DeskKlean-Portable-1.0.0.exe)** | Portable `.exe` | Standalone single-file executable. Runs directly without installation. |

### ⚠️ Windows SmartScreen Notice

DeskKlean binaries are currently **not code-signed** with an expensive EV certificate. When launching the app for the first time, Windows SmartScreen will display:

> *"Windows protected your PC"*

To proceed: Click **More info** → **Run anyway**. This warning is standard for new open-source binaries until install reputation builds with Microsoft.

---

## Core Feature Modules

All ten modules are fully implemented with real Windows system integration:

| Module | What It Does | Safety & Integrity Rails |
|---|---|---|
| **SmartClean** | Scans and cleans user temp, system temp, thumbnail caches, error reports, and delivery optimization files. | Per-file in-use lock detection; Recycle Bin for recoverable items; irreversible warnings for system caches. |
| **Startup Optimizer** | Enumerates and manages Windows autostart entries across registry (`Run`, `RunOnce`) and Startup folders. | Configures genuine startup delay (`HKCU\...\Explorer\Serialize`); creates `.reg` backups before any modification. |
| **Registry Fixer** | Scans for provably orphaned keys, missing application paths, broken shared DLLs, and stale MUI cache entries. | Conservative, zero-heuristic scanning; exports full `.reg` rollback files before executing any fix. |
| **App Remover** | Discovers installed Win32 software from 32-bit and 64-bit registry uninstall keys. | Prefers silent MSI uninstallers; **verifies removal by registry re-enumeration**, never trusting exit codes alone. |
| **Duplicate Finder** | Identifies duplicate files using staged size filtering, partial hashing, and full cryptographic SHA-256 comparisons. | Mandatory keep-copy safety guards; Recycle Bin deletion via Shell API with PowerShell fallback. |
| **Disk Analyzer** | Directory tree walk calculating honest folder sizes and file category distributions. | Percentages calculated strictly against measured `scannedBytes`; proper reparse point / junction handling. |
| **Secure Erase** | Cryptographic random-byte file shredding and free-space wiping with `fsync` flushing. | Free-space wiping enforces a 100 MB headroom floor to prevent disk exhaustion; explicit SSD wear-leveling disclaimers. |
| **Extension Manager** | Enumerates installed extensions across Chrome, Edge, Brave, and Firefox profiles. | **Strictly read-only** (per D-R2-7) to prevent corrupting Chromium HMAC signatures; deep-links to browser management pages. |
| **Health Check** | System health dashboard aggregating metrics across all modules into an overall score. | Pure aggregator with no independent scan logic; reports `null` rather than fabricating fake scores. |
| **System Info** | Real-time hardware and operating system telemetry via typed CIM queries. | Graceful per-section degradation; 64-bit VRAM scaling; Google Drive FAT32 capacity corrections. |

---

## Safety & Architectural Principles

1. **Never Invent a Value:** Read-only queries return measured data or `null`. No simulated progress counters or hardcoded mock reclaim values.
2. **Verify by Read-Back:** Every destructive operation verifies success by inspecting the system state after execution (e.g. confirming registry keys or files are gone).
3. **Back Up Before Destroying:** Destructive operations produce complete, enumerable backups (`.reg` files for registry, Recycle Bin for user documents).
4. **Fail Closed:** When permissions or capabilities cannot be confirmed, operations refuse up front rather than failing halfway through.
5. **Immutable Protected Paths:** Core system paths (`C:\Windows`, `System32`, `SysWOW64`, `Program Files`, etc.) are permanently blocked from deletion.

---

## Tech Stack

- **Shell:** Electron 28
- **Frontend:** React 18, Vite 5, Tailwind CSS 4, Framer Motion, Lucide Icons
- **Backend:** Node.js, TypeScript, PowerShell / CIM query bridge (`src/main/system/`)
- **Packaging:** electron-builder (NSIS + Portable targets)
- **CI / Pipeline:** GitHub Actions on `windows-latest` pinned to Node `20.x`

---

## Developer Guide

### Prerequisites
- Windows 10/11 (x64)
- Node.js 20.x (see `.nvmrc`)
- PowerShell 5.1+

### Getting Started

```bash
# Clone the repository
git clone https://github.com/chairielazizi/deskklean.git
cd deskklean

# Install dependencies
npm ci

# Run in development mode (Vite HMR + Electron)
npm run dev

# In a separate terminal or via the dev runner:
npm run electron:dev
```

### Type-Checking & Building

```bash
# Type-check main process
npx tsc -p tsconfig.main.json --noEmit

# Type-check renderer process
npx tsc -p tsconfig.json --noEmit

# Build production bundles
npm run build
```

### Running Test Suites

DeskKlean includes 11 automated test suites covering 950+ unit and logic tests:

```bash
# Run all pure-logic tests
node scripts/test-smartclean.mjs
node scripts/test-registry-fixer.mjs
node scripts/test-appremover.mjs
node scripts/test-duplicates.mjs
node scripts/test-disk-analyzer.mjs
node scripts/test-secure-erase.mjs
node scripts/test-extensions.mjs
node scripts/test-health.mjs
node scripts/test-system-info.mjs
node scripts/test-phase2-step7-8.mjs
node scripts/test-reg-escaper.mjs
```

### Packaging Windows Installers

```bash
# Builds NSIS installer and portable executable in release/
npm run dist
```

---

## Documentation Index

- [`docs/ROADMAP.md`](docs/ROADMAP.md) — The authoritative roadmap, completed phases, and decisions of record.
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — System architecture, IPC patterns, and framework design.
- [`docs/DESIGN-DECISIONS.md`](docs/DESIGN-DECISIONS.md) — Resolved design choices and requirements grilling notes.
- [`docs/RELEASE-NOTES.md`](docs/RELEASE-NOTES.md) — v1.0.0 release notes and module inventory.
- [`docs/PHASE-3-DESTRUCTIVE-FRAMEWORK.md`](docs/PHASE-3-DESTRUCTIVE-FRAMEWORK.md) — Core execution, backup, and verification framework.
- [`docs/PHASE-15A-CI-WORKFLOW.md`](docs/PHASE-15A-CI-WORKFLOW.md) — GitHub Actions CI pipeline specification.
- [`docs/PHASE-15-CICD-PACKAGING.md`](docs/PHASE-15-CICD-PACKAGING.md) — Packaging and distribution specifications.

---

## License

[MIT](LICENSE) © DeskKlean Team & Contributors
