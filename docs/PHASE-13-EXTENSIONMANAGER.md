# Phase 13 — Extension Manager (read-only)

**Status:** ✅ implemented and verified
**Depends on:** Phase 0 (system bridge) ✅ · Phase 3 (destructive framework) ✅
**Decision:** D-R2-7 — ExtensionManager is read-only. Toggle and remove are deleted, not implemented.

## Goal

Replace the hardcoded `browserExtensions` array with real enumeration of installed
browser extensions across the Chromium family (Chrome, Edge, Brave) and Firefox.
Display them — name, version, enabled state, install date — and deep-link to the
browser's own extensions page for any change the user wants to make.

This module **does not write**. It has no toggle, no remove, and no "manage"
button that performs an action. Every change action is a deep link to the
browser's native extensions UI.

## Why this module cannot write

The evidence is recorded in `ROADMAP.md` §6. It is reproduced here so that a
future contributor does not "fix" the missing feature without reading why it
is missing.

### Chromium family (Chrome, Edge, Brave)

Chromium records extension enabled state at `extensions.settings.<id>.state`
in the profile's `Preferences` file. The same values are mirrored in
`Secure Preferences`, which is **HMAC-SHA256 signed** with a seed embedded in
`resources.pak`. Editing `state` in `Preferences` without recomputing the HMAC
in `Secure Preferences` is **detectable tampering** — the browser detects the
mismatch and reverts or rejects the profile.

Both `Preferences` and `Secure Preferences` are **held open by the running
browser** and rewritten on exit. An edit made while the browser is running is
silently reverted when the browser closes. There is no supported external
write mechanism.

### Firefox

Firefox's `extensions.json` has no HMAC, but Firefox **rebuilds it** from the
actual extension install locations when the schema version or paths do not
match the file's current contents. An external edit is overwritten on the
next browser launch.

### The only supported mechanism

Both vendors' only supported mechanism for toggling or removing extensions
is an in-browser API: `chrome.management` for Chromium, `AddonManager` for
Firefox. Using these APIs from an external process would require shipping our
own browser extension — a separate product with its own review, distribution
and maintenance burden.

**A cleaner that corrupts a browser profile to toggle an extension is worse
than one that says "manage this in Chrome."** The write path is not a
missing feature; it is a deliberate non-feature.

### Fragility of reading

Even the read path is fragile. `Preferences`, `Secure Preferences` and
`extensions.json` are **internal, undocumented and version-dependent**
formats. Their schemas change between browser versions without notice.
The reader must:

- **Tolerate schema changes.** A missing field, a renamed key or a new
  structure must degrade that entry to `null`, not throw or crash the scan.
- **Never assume stability.** A schema that works today may not work after
  a browser auto-update. The reader is best-effort, not a stable contract.
- **Fail closed on parse errors.** A file that cannot be parsed is reported
  as unavailable, not as an empty list that looks like "no extensions."

These are the same principles the rest of the project applies to CIM
queries and registry values: degrade to `null`, never invent.

---

## Scope

### In scope

| Capability | Detail |
|---|---|
| Enumerate Chromium extensions | Name, version, enabled state, install date from `Preferences` |
| Enumerate Firefox extensions | Name, version, enabled state, install date from `extensions.json` |
| Display extensions | A table or list grouped by browser |
| Deep-link to browser extensions page | Opens the browser's native extensions UI |

### Out of scope (deleted, not unimplemented)

| Removed handler | Why |
|---|---|
| `EXTENSIONS_TOGGLE` | Would require editing signed/internal browser state. Deleted per D-R2-7. |
| `EXTENSIONS_REMOVE` | Same. Deleted per D-R2-7. |

These handlers do not exist in the contract. They are not "pending" or
"coming soon." They are removed because implementing them safely is not
possible through external file writes.

---

## Enumeration

### Chromium family

The scan reads the `Preferences` file from each installed Chromium-based
browser's profile directory. The relevant structure is:

```
extensions.settings.<id>.state        — enabled state (integer)
extensions.settings.<id>.version     — version string
extensions.settings.<id>.manifest     — manifest object containing name,
                                         version, install_time, etc.
```

The `manifest` object contains the display name and version. The `state`
field indicates whether the extension is enabled. Install date is derived
from `install_time` if present, or from file metadata as a fallback.

**`install_time` is a Chromium timestamp, not a Unix one.** It is
*microseconds since 1601-01-01 UTC* (the Windows FILETIME / WebKit epoch),
not milliseconds since 1970. A naive `new Date(install_time)` produces a
date in 1601. The conversion is:

```
unixMs = (install_time / 1000000) - 11644473600000
```

`11644473600000` is the number of milliseconds between 1601-01-01 and
1970-01-01. This conversion is a correctness requirement, not a
refinement: without it every install date in the UI is wrong.

**`state` is an integer, and it can be absent.**

| `state` value | Meaning | Field value |
|---|---|---|
| `1` | enabled | `enabled: true` |
| `0` | disabled | `enabled: false` |
| key missing | unknown | `enabled: null` |

Absent is **not** disabled. An extension whose `state` key is missing is
reported as `null`, because claiming `false` asserts something the file
does not say.

**`manifest.name` may be a placeholder, not a name.** Localised extensions
store `__MSG_appName__` (or similar) in `manifest.name` and the real string
in `_locales/<locale>/messages.json`. Read the manifest name first; if it
matches `^__MSG_[A-Za-z0-9_]+__$`, attempt the locale file and fall back to
the placeholder string if the locale file is unreadable. A placeholder is
honest; an invented name is not.

**Multiple profiles must be enumerated.** A Chromium install commonly has
`Default` plus `Profile 1`, `Profile 2`, … The scan enumerates every
profile directory that contains a `Preferences` file, not just the first.
Reading only `Default` produces a partial list that reads as complete —
the same honesty failure as reporting zero shred passes.

Profile directories to check, per browser:

| Browser | Base directory |
|---|---|
| Chrome | `%LOCALAPPDATA%\Google\Chrome\User Data` |
| Edge | `%LOCALAPPDATA%\Microsoft\Edge\User Data` |
| Brave | `%LOCALAPPDATA%\BraveSoftware\Brave-Browser\User Data` |

Within each base, enumerate `Default` and every `Profile *` entry that
contains a `Preferences` file.

**UNVERIFIED:** The exact schema of `extensions.settings.<id>` varies by
Chromium version. The reader must handle missing fields gracefully and
report `null` for any field it cannot extract. The base paths above must
be confirmed on the target machine during implementation; a browser whose
base directory does not exist is reported as not installed, and a browser
whose directory exists but whose `Preferences` cannot be read is reported
as unavailable **with a reason** — never as an empty extension list.

### Firefox

The scan reads `extensions.json` from the Firefox profile directory. The
relevant structure is:

```
{ "addons": [ { "id", "name", "version", "active", ... }, ... ] }
```

**The `addons` array is the container.** It is not at the root of the file.
A parser that reads the root for extension objects finds nothing and
returns an empty list — which reads as "no extensions installed". The
`addons` key must be named explicitly.

| Field | Meaning | Field value |
|---|---|---|
| `addons[].active` | `true`/`false` | `enabled: true` / `enabled: false` |
| `addons[].name` | display name | `name` |
| `addons[].version` | version string | `version` |
| `addons[].id` | extension id | `id` |

`active` can be absent for some addon types. Report `enabled: null`, not
`false` — absent is not disabled.

**UNVERIFIED:** The exact schema of `extensions.json` varies by Firefox
version. Same tolerance principle: degrade to `null`, never throw.

Firefox profile discovery is **not** a simple directory name. Firefox
stores profiles under `%APPDATA%\Mozilla\Firefox\Profiles\`, and the
profile directory names are random suffixes (e.g.
`a1b2c3d4.default-release`). The scan must enumerate the `Profiles`
directory, not look for a fixed name. The `profiles.ini` file in
`%APPDATA%\Mozilla\Firefox\` is optional to read; enumerating `Profiles\*\extensions.json`
directly is sufficient and avoids depending on `profiles.ini`'s schema.

### Browser detection

The scan detects installed browsers by checking for the existence of their
profile directories. A browser that is not installed is simply absent from
the results. A browser that is installed but whose profile cannot be read
is reported as unavailable with a reason.

---

## Deep-linking

Each extension entry includes a "Manage" action that opens the browser's
native extensions page. The deep links are:

| Browser | Deep link | Mechanism |
|---|---|---|
| Chrome | `chrome://extensions` | `shell.openExternal` |
| Edge | `edge://extensions` | `shell.openExternal` |
| Brave | `brave://extensions` | `shell.openExternal` |
| Firefox | `about:addons` | **executable launch**, not `openExternal` |

These are standard browser URLs, not invented paths. They open the
browser's own UI, where the user can toggle or remove extensions using
the supported mechanism.

**Firefox cannot be opened with `shell.openExternal`.** Chrome, Edge and
Brave register their URL scheme (`chrome`, `edge`, `brave`) as a Windows
shell protocol handler, so `openExternal` routes correctly. **Firefox does
not register `about:` as a shell protocol.** `shell.openExternal('about:addons')`
rejects with "no application is associated with the specified file". The
Firefox path must instead locate `firefox.exe` (from the standard install
paths `%PROGRAMFILES%\Mozilla Firefox\firefox.exe` or
`%PROGRAMFILES(X86)%\Mozilla Firefox\firefox.exe`, or the registry uninstall
key) and spawn it as `firefox.exe -url about:addons`.

**The launch result must be awaited and reported honestly.**
`shell.openExternal` returns a `Promise` that rejects on failure. A handler
that returns `{ success: true }` before the promise settles reports success
for a launch that never happened. The handler must `await` the launch and
return `{ success: false, reason }` on rejection — for example when no
`firefox.exe` could be located, or when the protocol handler is missing.
The UI must render that failure, not silently do nothing.

**A deep link is only offered for a browser that is installed.** The
enumeration already knows which browsers are installed; the "Manage" action
is absent for a browser that is not installed, rather than present and
failing.

---

## Contract changes

| Change | Detail |
|---|---|
| `browserExtensions` | real, from `Preferences` / `extensions.json` |
| `ExtensionItem` | new type: `{ id, name, version, enabled, installDate, browser, profilePath }` |
| `EXTENSIONS_GET` | returns real `ExtensionItem[]`, grouped by browser |
| `EXTENSIONS_TOGGLE` | **deleted** |
| `EXTENSIONS_REMOVE` | **deleted** |
| new `EXTENSIONS_OPEN_PAGE` | deep-links to the browser's extensions page; **awaits the launch and reports failure honestly** |
| new `EXTENSIONS_RESCAN` | discards the cached enumeration and scans again |

The preload contract changes: `EXTENSIONS_TOGGLE` and `EXTENSIONS_REMOVE`
are removed from the type definitions and the IPC handler map. This is a
breaking change for the renderer, which must be updated to remove the
toggle and remove UI.

**The renderer must delete the toggle and remove UI, not disable it.** A
disabled button still advertises a capability the app does not have; the
correct rendering is that the control does not exist. The extensions page
shows a deep-link button in its place.

**Enumeration is cached for the app's lifetime, with a manual re-scan.**
Reading `Preferences` and `extensions.json` is a filesystem scan of files
that may be tens of megabytes. The first visit to the extensions page
scans; subsequent visits return the cached result. A manual re-scan action
is provided and is the only way to refresh. A scan must also re-run when
the user changes an extension in the browser's own UI, which the user
cannot trigger from inside DeskKlean — hence the explicit re-scan control.
A stale cache must be labelled as such in the UI ("last scanned <time>"),
never presented as current.

---

## Files

```
src/main/system/extensions.ts   NEW  — browser detection, profile discovery,
                                     Preferences / extensions.json parsing,
                                     deep-link launching
src/main/ipc.ts                 EDIT — remove EXTENSIONS_TOGGLE, EXTENSIONS_REMOVE;
                                     rewire EXTENSIONS_GET to real enumeration;
                                     add EXTENSIONS_OPEN_PAGE
src/shared/types.ts            EDIT — remove toggle/remove types; add ExtensionItem,
                                     BrowserId, ExtensionPageTarget
src/renderer/.../ExtensionManager.tsx  EDIT — remove toggle/remove UI; add deep-link
                                     button; handle unavailable browsers
scripts/test-extensions.mjs    NEW  — pure-logic tests for parsers
```

---

## Implementation order

1. **Browser detection** — check for installed browsers by profile directory existence. No file parsing yet.
2. **Chromium parser** — read `Preferences`, extract extension entries, tolerate schema variations.
3. **Firefox parser** — read `extensions.json`, extract extension entries, tolerate schema variations.
4. **Deep-link** — `EXTENSIONS_OPEN_PAGE` via `shell.openExternal`.
5. **UI** — real list, grouped by browser, deep-link button, unavailable states.

Steps 1–4 are read-only. No destructive capability exists in this module.

---

## Verification

Pure logic, runs on the build machine, required before the phase is done:

- Chromium parser: extract extensions from a sample `Preferences` JSON with known schema
- Firefox parser: extract extensions from a sample `extensions.json` with known schema
- Schema tolerance: missing fields produce `null`, not throws
- Browser detection: returns correct browser list for given profile directory states

Plus, specifically covering the defects this amendment fixes:

- **`install_time` conversion:** given `install_time = 133_000_000_000_000_000`
  (a plausible Chromium microsecond timestamp), the parser returns a date in
  2020-something, **not 1601**. This test fails if the raw value is passed
  to `new Date()` unconverted.
- **Multiple profiles:** given a base directory containing `Default` and
  `Profile 1`, both are scanned and the results merged. A parser that reads
  only `Default` fails this test.
- **Firefox `addons` wrapper:** the parser reads `addons` from the root and
  returns its entries. A parser that reads the root directly returns an
  empty list and fails this test.
- **`state` mapping:** `state: 1` → `enabled: true`; `state: 0` →
  `enabled: false`; a missing `state` key → `enabled: null` (not `false`).
- **Unavailable is not empty:** a browser whose `Preferences` cannot be read
  is reported as unavailable with a reason, never as an empty list.

Windows acceptance, run by the owner:

1. Install Chrome and Firefox with at least 2 extensions each
2. Run the scan — confirm all extensions appear with correct name, version and enabled state
3. **Confirm the install date is a plausible modern date, not 1601** — this
   is the visible symptom of the `install_time` conversion defect
4. Toggle an extension in the browser's own UI, re-scan — confirm the state changed
5. Click "Manage" on a Chrome extension — confirm Chrome opens its extensions page
6. Click "Manage" on a Firefox extension — confirm Firefox opens `about:addons`.
   **This is the test that fails if the Firefox path still uses `shell.openExternal`**
7. Confirm a browser that is not installed shows no "Manage" action at all
8. Confirm the cached result is returned on a second visit and that the
   re-scan control refreshes it, with the UI showing when it last scanned

---

## Risks

| Risk | Mitigation |
|---|---|
| Browser profile path varies by installation | Detect by checking known profile directory patterns; degrade to "not found" rather than guessing |
| Schema change in `Preferences` or `extensions.json` | Tolerate unknown/missing fields; report `null`; never throw |
| Running browser holds file open | Read is still possible on Windows (shared read); if read fails, report unavailable |
| A contributor "fixes" the missing toggle | This document's "Why this module cannot write" section is the guard — it carries the HMAC and file-rebuild evidence from ROADMAP §6 |
| Deep link opens wrong browser | Chrome, Edge and Brave register their URL scheme as a shell protocol handler, so `openExternal` routes to the correct browser if installed. **Firefox is the exception:** it does not register `about:` as a protocol, so the Firefox path launches `firefox.exe -url about:addons` directly. A missing protocol handler or executable is reported as a failure, never as success. |
