# DeskKlean Architecture

## Overview

DeskKlean is an open-source, privacy-respecting Windows desktop application for system cleanup and optimization. It is engineered with a strict honesty principle: **every module performs real work, never invents values, verifies operations by re-reading system state, and backs up before making changes.**

The application is built with Electron + React + TypeScript, leveraging a typed PowerShell and CIM (Common Information Model) bridge for Windows system interactions, and a shared destructive-operation framework for safe file and registry operations.

---

## Tech Stack

- **Desktop Shell:** Electron 28
- **Frontend:** React 18 + Vite 5 + TypeScript
- **Styling:** Tailwind CSS 4 (via `@tailwindcss/postcss`) + Framer Motion + Lucide Icons
- **Backend:** Node.js 20 runtime + TypeScript (compiled to CommonJS in `dist/main/`)
- **System Bridge:** Direct `powershell.exe` process execution and typed CIM/WMI queries (no `shell: true`, UTF-8 encoded, timeout-guarded)
- **Configuration & Storage:** JSON file store in `%APPDATA%\deskklean\settings.json`; in-memory activity logs
- **Packaging:** `electron-builder` producing per-user NSIS installer and standalone Portable `.exe`
- **CI / CD:** GitHub Actions on `windows-latest` with pinned Node 20.x

---

## Project Structure

```
DeskKlean/
├── .github/
│   └── workflows/
│       └── ci.yml                 # Automated CI/CD pipeline
├── docs/                          # Architectural specifications and phase docs
├── resources/                     # Application icons and assets
│   ├── icon.ico
│   └── icon.png
├── scripts/                       # 11 automated test suites (test-*.mjs)
├── src/
│   ├── main/                      # Electron main process
│   │   ├── main.ts                # App lifecycle & BrowserWindow management
│   │   ├── ipc.ts                 # IPC channel registrations & routing
│   │   ├── tray.ts                # System tray integration
│   │   ├── autoLaunch.ts          # Startup auto-launch configuration
│   │   └── system/                # System logic & subsystems
│   │       ├── powershell.ts      # Injection-safe PowerShell execution bridge
│   │       ├── cim.ts             # Typed CIM queries with WQL parameter sanitization
│   │       ├── parse.ts           # CIM/WMI output normalizers
│   │       ├── elevation.ts       # UAC elevation detection & portable-aware relaunch
│   │       ├── settings.ts        # Persistent JSON settings manager
│   │       ├── activityLog.ts     # In-memory activity logging
│   │       ├── framework/         # Shared destructive-operation framework
│   │       │   ├── types.ts       # Action, Plan, and Execution types
│   │       │   ├── plan.ts        # Plan construction & reversibility declaration
│   │       │   ├── execute.ts     # Action runner (delete-file, delete-tree, registry, uninstall)
│   │       │   ├── backup.ts      # .reg backup generation & Recycle Bin operations
│   │       │   ├── protected.ts   # Core Windows immutable path enforcement
│   │       │   └── store.ts       # OperationPlan memory store
│   │       ├── smartclean/        # SmartClean scan & execution subsystem
│   │       ├── registry-fixer/    # Registry scanner & .reg fixer subsystem
│   │       ├── disk-analyzer/     # Directory walking & size aggregation subsystem
│   │       ├── duplicate-finder/  # Content hashing & duplicate detection subsystem
│   │       ├── appRemover.ts      # Win32 uninstall enumeration & verification
│   │       ├── extensions.ts      # Read-only browser extension inventory & deep-links
│   │       ├── secureErase.ts     # Cryptographic file shredding & free-space wiper
│   │       ├── startup.ts         # Startup item enumeration, delay & .reg restore
│   │       ├── health.ts          # Pure aggregator health assessment
│   │       └── systemInfo.ts      # Hardware & OS telemetry queries
│   ├── preload/                   # Electron preload scripts
│   │   └── index.ts               # contextBridge exposing typed DeskKleanAPI
│   ├── renderer/                  # React frontend application
│   │   ├── App.tsx                # Main view router & shell layout
│   │   ├── apiClient.ts           # Type-safe window.api bridge with mock fallback
│   │   └── components/            # UI module views
│   └── shared/                    # Code shared across main, preload, and renderer
│       ├── constants.ts           # IPC channel name constants
│       └── types.ts               # Complete TypeScript domain contracts
├── electron-builder.yml           # Packaging configuration (NSIS + Portable)
├── package.json                   # Dependencies, scripts, and v1.0.0 metadata
├── tsconfig.json                  # Renderer TypeScript configuration
├── tsconfig.main.json             # Main process TypeScript configuration
└── vite.config.ts                 # Vite bundler configuration
```

---

## Core System Modules

### 1. Health Check (`health.ts`)
- **Pure Aggregator (Decision D-R2-6):** Owns no independent scan or heuristic logic. It invokes the other modules' scan routines and aggregates metrics into an overall system score.
- Reports `null` score when constituent scans cannot be measured, preventing fabricated score claims.

### 2. SmartClean (`smartclean/`)
- Scans Windows temporary directories, user caches, error report queues, delivery optimization files, and thumbnail databases.
- Performs per-file in-use lock probing.
- Routes recoverable user data to the Recycle Bin (`reversible: true`) and irreversible system caches with explicit consequence warnings (`reversible: false`).

### 3. Registry Fixer (`registry-fixer/`)
- Scans for provably orphaned keys, missing shared DLL references, broken shortcuts, and stale MUI cache entries.
- Adheres to a strict zero-heuristic policy: entries are flagged only when the referenced target path demonstrably does not exist.
- Emits UTF-16LE `.reg` backup files before applying any registry deletion, with full rollback support.

### 4. Startup Optimizer (`startup.ts`)
- Enumerates autostart items across `HKCU\...\Run`, `HKLM\...\Run`, `HKLM\...\RunOnce`, and the Windows Startup folder.
- Configures real startup delays using `HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\Serialize\StartupDelayInMSec`.
- Exports `.reg` backup files with metadata comment headers before toggling or deleting items.

### 5. App Remover (`appRemover.ts`)
- Enumerates 32-bit and 64-bit software from `HKLM` and `HKCU` uninstall registry paths.
- Resolves silent uninstallation arguments, prioritizing Windows Installer (`msiexec.exe /X`) when a product GUID is present.
- **Verification by Re-enumeration:** Confirms uninstallation by re-reading registry keys after process-tree termination, never relying solely on uninstaller exit codes.

### 6. Extension Manager (`extensions.ts`)
- Multi-profile scanner discovering installed extensions across Chrome, Edge, Brave, and Firefox profiles.
- **Read-Only Invariant (Decision D-R2-7):** Does not write or toggle browser preference files (which corrupts Chromium HMAC signatures and causes Firefox file rebuilds).
- Native deep-linking: launches `chrome://extensions`, `edge://extensions`, `brave://extensions` via `shell.openExternal`, and directly spawns `firefox.exe -url about:addons`.

### 7. Disk Space Analyzer (`disk-analyzer/`)
- Recursive directory tree walk with category breakdown and top-N largest file listing.
- Percentages computed strictly against actual `scannedBytes`.
- Distinguishes intra-root reparse points from filesystem escape junctions, preventing infinite loops.

### 8. Duplicate File Finder (`duplicate-finder/`)
- Multi-stage duplicate detection: size bucketing → partial 4 KB header/footer hash → full SHA-256 content verification.
- Mandatory keep-copy safety guards (refuses to delete all copies of a file).
- Deletes to Recycle Bin via Electron's `shell.trashItem` with a PowerShell shell COM fallback.

### 9. Secure Erase (`secureErase.ts`)
- **File Shredding:** Overwrites target file contents with cryptographically secure random bytes (`crypto.randomBytes`), followed by `fsync` flushing before unlinking.
- **Free-Space Wiping:** Creates a temporary fill file (`$DeskKleanWipe.tmp`) overwriting volume slack space with zeroes, enforcing a strict 100 MB headroom floor to avoid disk starvation.
- Clear UI disclosures regarding SSD wear-leveling and controller-managed block remapping.

### 10. System Info (`systemInfo.ts`)
- Telemetry and hardware inventory using typed CIM queries (`Win32_OperatingSystem`, `Win32_Processor`, `Win32_VideoController`, `MSFT_PhysicalDisk`, etc.).
- Resolves 64-bit GPU VRAM beyond 4 GB 32-bit driver limits.
- Detects and corrects Google Drive Desktop FAT32 reported capacity anomalies.

---

## Shared Destructive-Operation Framework (`framework/`)

All destructive modules funnel their execution through the centralized framework:

```
[Module Scan] ──► [Build OperationPlan] ──► [UI Confirmation] ──► [Framework Execute] ──► [Verify by Re-Read] ──► [Activity Log]
```

1. **Plan:** Dry-run construction returning an `OperationPlan` with explicit `reversible` / `irreversible` declarations.
2. **Path Protection:** Compares every target against a strict protected blacklist (`C:\Windows`, `System32`, `SysWOW64`, `Program Files`, etc.).
3. **Backup Guarantee:** Writes `.reg` rollback scripts or moves files to Recycle Bin before applying changes; aborts immediately if backup creation fails.
4. **Elevation Guard:** Fails closed if administrative privileges are required but the process is unelevated.
5. **Verification:** Confirms that modified keys or files have actually ceased to exist before reporting success.

---

## Security & Elevation Model

- **Least Privilege Execution:** Packaged build specifies `requestedExecutionLevel: asInvoker`. DeskKlean runs unelevated by default for all safe, read-only inspection operations.
- **On-Demand Elevation:** When destructive tasks require administrative rights, DeskKlean prompts the user and relaunches itself elevated using `elevate.exe` or PowerShell `Start-Process -Verb RunAs`.
- **Portable Awareness:** Detects `PORTABLE_EXECUTABLE_FILE` when running as a portable binary, ensuring elevation relaunches the original portable file rather than a temporary extraction path.
- **Zero Telemetry:** Completely offline with no remote analytics, telemetry beacons, or external data transmission.

---

## Build & Distribution Pipeline

- **Packaging:** Built with `electron-builder`:
  - **NSIS Installer:** Per-user installation to `%LOCALAPPDATA%\Programs\DeskKlean` (no UAC required for installation).
  - **Portable:** Standalone executable running without extraction setup.
- **CI Pipeline:** Managed via `.github/workflows/ci.yml` on `windows-latest` with pinned Node `20.x`:
  - Dual type-checking (`tsconfig.main.json` and `tsconfig.json`).
  - Automated Bash loop executing all 11 pure-logic test suites (958 tests).
  - Tag-gated releases (`v*`) deploying binaries to GitHub Releases with changelog generation.
