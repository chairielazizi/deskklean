# DeskKlean — dev-server fix

## Root cause

`npm run dev` failed at Vite **config load**:

```
[plugin externalize-deps] "@tailwindcss/vite" resolved to an ESM file.
ESM file cannot be loaded by require.
```

`package.json` has no `"type": "module"`, so Vite 5 bundles `vite.config.ts` to **CJS** and
`require()`s its imports. `@tailwindcss/vite` is **ESM-only** — its `exports` map has no
`require` condition, only `default: ./dist/index.mjs`:

```json
"exports": { ".": { "types": "./dist/index.d.mts", "default": "./dist/index.mjs" } }
```

On Node versions without `require(esm)` support (Node < 22.12), that throws.

`@tailwindcss/postcss`, by contrast, ships **both** formats:

```json
"exports": { ".": { "import": {…index.mjs}, "require": {…index.js} } }
```

…and `postcss.config.js` already wires it up. So the Vite plugin was redundant.

## Fixes applied

### 1. `vite.config.ts` — drop the ESM-only plugin

Removed the `@tailwindcss/vite` import and its `tailwindcss()` plugin entry. Tailwind is now
processed solely through PostCSS. This also keeps `__dirname` working (still CJS).

### 2. `package.json` — remove the now-unused dependency

Removed `"@tailwindcss/vite": "^4.0.6"` from `devDependencies`.

### 3. `src/renderer/components/SmartClean.tsx` (line 22) — missing brace

```diff
-  application: label: 'Applications', icon: <HardDrive className="w-4 h-4" />, color: 'text-violet-400' },
+  application: { label: 'Applications', icon: <HardDrive className="w-4 h-4" />, color: 'text-violet-400' },
```

### 4. `src/renderer/App.tsx` — props not on the component contracts

`Header` takes only `systemScore?` (it manages its own window controls), and `Sidebar` takes
only `currentModule` / `onSelectModule` / `quickStats?`.

```diff
-      <Header
-        isMaximized={isMaximized}
-        onToggleMaximize={handleToggleMaximize}
-        onMinimize={handleMinimize}
-        onClose={handleClose}
-        title={APP_NAME}
-        version={APP_VERSION}
-      />
+      <Header />
...
         <Sidebar
           currentModule={currentModule}
           onSelectModule={handleNavigate}
-          isCollapsed={isSidebarCollapsed}
-          onToggleCollapse={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
         />
```

### 5. `src/renderer/components/SecureErase.tsx` (line 64) — wrong field name

```diff
-        message: `Securely shredded ${result.shreddedItems} items using …`,
+        message: `Securely shredded ${result.shreddedCount} items using …`,
```

### 6. `src/renderer/components/SystemInfo.tsx` — invalid icon name

`lucide-react` has no `Motherboard` export.

```diff
-  Motherboard,
+  CircuitBoard,
...
-            <Motherboard className="w-4 h-4 text-amber-400" />
+            <CircuitBoard className="w-4 h-4 text-amber-400" />
```

## Apply on Windows

```cmd
:: 1. Copy the fixed files over your E:\Coding\antigravity-projects\DeskKlean
::    (vite.config.ts, package.json, and the four files under src\renderer\)

:: 2. Prune the removed dependency and re-link
npm install

:: 3. Run
npm run dev
```

## Verification (run on Linux, Node 26.7.0, Vite 5.4.21)

| Check | Result |
|---|---|
| `npx tsc -p tsconfig.json --noEmit` | **0 errors** |
| `npx vite build` | **✓ 2010 modules transformed**, built in 3.40s |
| → `dist/renderer/index.html` | 1.09 kB (gzip 0.62 kB) |
| → `dist/renderer/assets/index-*.css` | 52.95 kB (gzip 8.58 kB) — Tailwind emitting via PostCSS |
| → `dist/renderer/assets/index-*.js` | 409.53 kB (gzip 116.27 kB) |
| `npx vite` (dev server) | **ready in 178 ms**, `http://localhost:5173/` |
| `GET /` | 200 — 1257 bytes |
| `GET /src/renderer/main.tsx` | 200 — 2419 bytes |
| `GET /src/renderer/index.css` | 200 — 70,610 bytes (Tailwind utilities generated) |
| `GET /src/renderer/App.tsx` | 200 — 23,901 bytes |
| `npm run build:main` | exit 0 — `dist/main/{main,ipc,tray,autoLaunch}.js` emitted |

The dev server logged no transform errors while serving those modules.

---

## Electron Runtime & Portable Package Fixes

### 1. Electron Installation (`postinstall` failure)
- **Problem**: Electron failed to install due to network/symlink restrictions during npm postinstall (`node install.js`), resulting in `node_modules/electron/dist/electron.exe` missing.
- **Fix**: Extracted Electron v28.3.3 binaries and properly configured `node_modules/electron/path.txt` to point to `electron.exe`.

### 2. `electron-builder` Packaging (`winCodeSign` symlink privilege error)
- **Problem**: On Windows non-developer mode, `electron-builder` failed to extract `winCodeSign-2.6.0.7z` with `ERROR: Cannot create symbolic link : A required privilege is not held by the client : ...\darwin\10.12\lib\libcrypto.dylib`.
- **Fix**: Pre-extracted the archive into `%LOCALAPPDATA%\electron-builder\Cache\winCodeSign\winCodeSign-2.6.0`, replacing the Mach-O symlinks (`libcrypto.dylib`, `libssl.dylib`) with real file copies.

### 3. Vulnerability Resolution
- **Fix**: Added targeted overrides in `package.json` for `tar: ^7.5.22` and `esbuild: ^0.25.0` to eliminate high/critical CVEs while preserving Electron 28 / Vite 5 compatibility.

### 4. Split-Second Flash & Crash on Launch (`EPIPE` & Singleton Lock)
- **Problem**: Launching `DeskKlean-Portable-1.0.0.exe` or the unpacked application appeared for a split second and then vanished.
  - **Cause A (EPIPE Crash)**: In Windows GUI subsystem mode (without an attached console stdout pipe), calling `console.log()` inside `main.ts` triggered an unhandled `Error: EPIPE: broken pipe, write` stream exception.
  - **Cause B (Singleton Lock Contention)**: When previous crashed/headless processes lingered in memory, `app.requestSingleInstanceLock()` returned `false` on any subsequent launch, triggering an immediate `app.quit()` without opening a window.
- **Fix**:
  - Implemented safe file-based logging and installed error event suppressors for `process.stdout` and `process.stderr` against `EPIPE`.
  - Added robust single-instance and second-instance handling: when another launch is attempted, the existing window is restored and focused, with a `createWindow()` fallback if the window was closed.
  - Added a defensive `ready-to-show` fallback timeout to guarantee window visibility under any OS timing condition.

### 5. Elevation Prompt Persistence & Admin Relaunch Conflict Fixes
- **Problem A (Disappearing Launch Prompt)**: In `App.tsx`, the startup elevation modal was permanently gated behind `settings.elevationPromptDismissed === false`. Clicking "Continue without administrator" once persisted `true` to `settings.json`, suppressing the prompt on every subsequent launch.
  - **Fix**: Removed the persistent dismissal lock. When `isElevated() === false`, the prompt displays on every launch. Clicking "Continue without administrator" dismisses it solely for the current session.
- **Problem B (Old Window Sitting / Elevated Window Dying)**: When clicking "Restart as administrator", the old unelevated instance remained running in dev mode while holding `app.requestSingleInstanceLock()`. The new elevated instance called `requestSingleInstanceLock()`, received `false`, and immediately exited. In dev mode, the old window remained open without an elevated window opening. In packaged portable mode, launching the extracted temp child binary while the parent wrapper closed triggered directory deletion and instant crash.
  - **Fix**:
    1. In `src/main/ipc.ts`, when packaging in portable mode, `relaunchElevated` targets `process.env.PORTABLE_EXECUTABLE_FILE` (the portable launcher), not the transient temp binary.
    2. Once `relaunchElevated` succeeds, the unelevated process calls `app.releaseSingleInstanceLock()` and cleanly exits (`app.exit(0)`).
    3. In `src/main/main.ts`, `app.requestSingleInstanceLock()` includes a retry grace period (up to 2s) to allow a yielding parent process to release the lock cleanly.
    4. In `package.json`, replaced `concurrently -k` with `concurrently --kill-others-on-fail` so Vite and the dev server stay running when the unelevated process yields to the elevated one.

### 6. WMI CPU Temperature Permission (`MSAcpi_ThermalZoneTemperature` 0x80041003)
- **Problem**: When running unelevated in dev or standard mode, querying CPU temperature triggered PowerShell error spam in console: `[cim:MSAcpi_ThermalZoneTemperature] Failed to query CPU temperature: Error: PowerShell execution failed (code 1): Get-CimInstance : Access denied ... HRESULT 0x80041003`.
- **Root Cause**:
  1. The WMI namespace `root\wmi` is restricted by Windows security ACLs to elevated administrative accounts. Standard user tokens receive `0x80041003` (Access Denied).
  2. On modern desktop motherboards (such as AMD AM5 B650 / Ryzen 7000 desktop platforms), ACPI thermal zones are not implemented in motherboard BIOS DSDT tables anyway. Desktop thermal telemetry (Tctl/Tdie) is handled via internal CPU MSRs or Super I/O hardware sensors via ring-0 kernel drivers (such as HWiNFO or LibreHardwareMonitor), not through generic ACPI WMI.
- **Impact & Fix**:
  - CPU temperature is completely **negligible** for DeskKlean (it is solely a cosmetic telemetry metric in the System Specs dashboard, and the UI cleanly displays "Unavailable" when `null`).
  - In `src/main/system/cim.ts`, updated `getCpuTemperature` to intercept `0x80041003` (Access Denied) and `0x8004100c` / `0x80041010` (Not Supported / Invalid Class) and log a graceful single-line note once via `warnOnce` instead of dumping raw multi-line PowerShell stack traces to stderr.

### 7. Module Tab Navigation & Two-Tier Caching System
- **Problem**:
  1. Switching between sidebar tabs caused the entire app shell to unmount and show a full-screen `Loading DeskKlean...` screen for 300ms because of an artificial `setIsLoading(true)` timeout inside `handleNavigate`.
  2. Navigating to System Info or Startup Optimizer, switching to another page, and coming back triggered a full page loader and executed heavy PowerShell CIM/registry queries repeatedly (~2-3s delay every visit).
- **Fix**:
  1. **Instant Module Switching**: Removed the artificial loading delay in `App.tsx`'s `handleNavigate`, allowing smooth Framer Motion transitions (`AnimatePresence`) between tabs without unmounting the app shell.
  2. **Renderer Data Cache (`src/renderer/utils/dataCache.ts`)**:
     - Created a client-side in-memory cache manager (`dataCache`) for `SystemSpecs` (5 min TTL) and `StartupItems` (2 min TTL).
     - `SystemInfo` and `StartupOptimizer` initialize their component state directly from `dataCache`, rendering all cards and tables **instantly in 0ms** on revisit.
     - Background revalidation occurs silently without blocking the UI if the cache becomes stale.
     - In `StartupOptimizer`, toggling an item optimistically updates the cache (`updateStartupItem`), preserving the toggle state when switching away and back.
     - Added an inline `Refresh` button in the header of `StartupOptimizer` (matching `SystemInfo`) to allow users to force a fresh scan on demand.
  3. **Main Process IPC Cache (`src/main/ipc.ts`)**:
     - Added in-memory TTL caching (60s for specs, 30s for startup items) to prevent redundant parallel PowerShell script executions. Cache is automatically invalidated when items are toggled.

### 8. Phase 2 Steps 7 & 8 Verification and Framework Robustness
- **Features Tested**:
  1. **Step 7 (Global Startup Delay Control)**:
     - `getStartupDelay` and `setStartupDelay` writing to `HKCU\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\Serialize`.
     - Tested `0` ms (instant), `5000` ms, and `null` (reset to Windows default ~10s).
     - Verified strict distinction between `0` (explicit no delay) and `null` (absent/default).
     - Confirmed in Windows registry via PowerShell that `StartupDelayInMSec` and `WaitForIdleState` match exactly and are deleted on reset.
  2. **Step 8 (Startup Backups & Phase 3 Destructive Framework)**:
     - Verified backup listing with real metadata comments (itemName, hive, location, valueName, timestamp, size, summary).
     - Verified path traversal protection against `..`, slashes, backslashes, absolute paths, and null-byte injection.
     - Verified `.reg` file header assertion (`Windows Registry Editor Version 5.00`) before running `reg.exe import`.
     - Verified single-instance lock and HKLM elevation gating on restores.
     - Hardened `getModuleBackupDir` in `backup.ts` to align with `app.getPath('userData')` when running inside Electron.
     - Hardened PowerShell `reg.exe import` path passing using single-quote escaping (`& reg.exe import $p`).
  3. **Test Results**:
     - `node scripts/test-phase2-step7-8.mjs`: 49/49 unit tests passed.
     - `node scripts/test-phase2-live.mjs`: 31/31 live integration tests passed on Windows.
     - Main process (`npm run build:main`) and Renderer (`npx vite build`) build cleanly with 0 errors.
