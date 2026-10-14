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

