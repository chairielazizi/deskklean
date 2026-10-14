# DeskKlean Architecture

## Overview

DeskKlean is a Windows desktop application for system cleanup and optimization, inspired by CCleaner Pro. It is built with Electron + React + TypeScript and uses Node.js native modules for system-level operations.

## Tech Stack

- **Desktop Shell:** Electron 28
- **Frontend:** React 18 + Vite 5 + TypeScript
- **Styling:** Tailwind CSS 4 + Framer Motion + Lucide Icons
- **Backend:** Node.js native modules + PowerShell integration
- **Database:** SQLite (better-sqlite3) for local config & scan history
- **Build:** electron-builder for Windows installer

## Project Structure

```
DeskKlean/
├── package.json
├── tsconfig.json
├── vite.config.ts
├── electron-builder.yml
├── tailwind.config.js
├── postcss.config.js
├── index.html
├── src/
│   ├── main/              # Electron main process
│   │   ├── main.ts        # Entry point
│   │   ├── ipc.ts         # IPC handlers
│   │   ├── tray.ts        # System tray
│   │   └── autoLaunch.ts  # Auto-start management
│   ├── preload/           # Preload scripts (contextBridge)
│   │   └── index.ts
│   ├── renderer/          # React frontend
│   │   ├── App.tsx
│   │   ├── components/
│   │   │   ├── Dashboard.tsx
│   │   │   ├── Sidebar.tsx
│   │   │   ├── HealthCheck.tsx
│   │   │   ├── SmartClean.tsx
│   │   │   ├── RegistryFixer.tsx
│   │   │   ├── StartupOptimizer.tsx
│   │   │   ├── AppRemover.tsx
│   │   │   ├── ExtensionManager.tsx
│   │   │   ├── DiskAnalyzer.tsx
│   │   │   ├── DuplicateFinder.tsx
│   │   │   ├── SecureErase.tsx
│   │   │   ├── SystemInfo.tsx
│   │   │   └── Settings.tsx
│   │   ├── hooks/
│   │   ├── store/
│   │   └── utils/
│   ├── shared/            # Shared types & constants
│   │   ├── types.ts
│   │   └── constants.ts
│   └── assets/            # Icons, images
├── native/                # Node.js native modules
│   ├── cleaner/
│   ├── registry/
│   ├── startup/
│   └── disk/
├── resources/             # Electron resources
│   ├── icon.ico
│   └── icon.png
└── docs/
    ├── ARCHITECTURE.md
    ├── REA_ANALYSIS.md
    └── BUILD.md
```

## Core Modules

### 1. Health Check (One-Click Clean)
- Scans all categories in one pass
- Shows issues found with severity indicators
- One-click fix with undo support

### 2. Smart Clean
- Junk files: temp, cache, logs, crash dumps
- Browser data: Chrome, Edge, Firefox, Brave
- Windows: recycle bin, thumbnails, DNS cache
- Custom rules: user-defined paths & patterns

### 3. Registry Fixer
- Scans for invalid entries: missing DLLs, broken shortcuts, orphaned software keys
- Backs up registry before changes
- Categorizes issues by severity

### 4. Startup Optimizer
- Lists all startup items (registry + startup folder)
- Shows impact rating (CPU/disk/memory)
- Enable/disable with one click
- Delay start option

### 5. App Remover
- Lists installed programs with size, install date
- Uninstall with leftover file detection
- Batch uninstall
- Force remove for stubborn apps

### 6. Extension Manager
- Browser extensions for Chrome, Edge, Firefox
- Enable/disable/remove extensions
- Shows permissions and ratings

### 7. Disk Space Analyzer
- Treemap visualization of disk usage
- Drill-down into folders
- File type breakdown
- Large file finder

### 8. Duplicate File Finder
- Hash-based duplicate detection
- Preview images before delete
- Auto-select by rules (keep newest, keep in specific folder)

### 9. Secure Erase
- File shredding (DoD 5220.22-M, Gutmann)
- Free space wiping
- Drive wipe (full/partition)

### 10. System Info
- Hardware summary (CPU, RAM, GPU, disk)
- OS info & activation status
- Network info
- Real-time monitoring (CPU, RAM, disk, network graphs)

## IPC Architecture

```
Renderer (React)  ←→  Preload (contextBridge)  ←→  Main (Electron)  ←→  Native Modules
```

All system operations go through IPC to the main process, which calls native modules or PowerShell scripts.

## Security & Safety

- **UAC elevation** only when needed (registry, startup, uninstall)
- **Backup before modify** — registry backups, file recycle bin
- **Sandboxed scanning** — read-only scan mode, no changes without user approval
- **No telemetry** — fully offline, no data collection
- **Open source** — MIT licensed

## Build & Distribution

- **Installer:** NSIS via electron-builder
- **Portable:** Single .exe with embedded runtime
- **Auto-update:** electron-updater with GitHub Releases
- **Signing:** Code signing certificate (EV)
