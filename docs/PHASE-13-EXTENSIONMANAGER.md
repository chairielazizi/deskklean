# Phase 13 — Extension Manager (read-only)

**Status:** 🔜 specified, not built
**Depends on:** Phase 0 (system bridge) ✅ · Phase 3 (destructive framework) 🔜
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

**UNVERIFIED:** The exact schema of `extensions.settings.<id>` varies by
Chromium version. The reader must handle missing fields gracefully and
report `null` for any field it cannot extract. The paths to profile
directories for Chrome, Edge and Brave are known from documentation but
must be confirmed on the target machine during implementation.

### Firefox

The scan reads `extensions.json` from the Firefox profile directory. The
relevant structure contains extension objects with name, version and
active/disabled state.

**UNVERIFIED:** The exact schema of `extensions.json` varies by Firefox
version. Same tolerance principle: degrade to `null`, never throw.

### Browser detection

The scan detects installed browsers by checking for the existence of their
profile directories. A browser that is not installed is simply absent from
the results. A browser that is installed but whose profile cannot be read
is reported as unavailable with a reason.

---

## Deep-linking

Each extension entry includes a "Manage" action that opens the browser's
native extensions page:

| Browser | Deep link |
|---|---|
| Chrome | `chrome://extensions` |
| Edge | `edge://extensions` |
| Brave | `brave://extensions` |
| Firefox | `about:addons` |

These are standard browser URLs, not invented paths. They open the
browser's own UI, where the user can toggle or remove extensions using
the supported mechanism.

The deep link is opened via `shell.openExternal` on the URL. On Windows,
this launches the default browser. If the browser is already running, it
opens a new tab in the existing instance.

---

## Contract changes

| Change | Detail |
|---|---|
| `browserExtensions` | real, from `Preferences` / `extensions.json` |
| `ExtensionItem` | new type: `{ id, name, version, enabled, installDate, browser, profilePath }` |
| `EXTENSIONS_GET` | returns real `ExtensionItem[]`, grouped by browser |
| `EXTENSIONS_TOGGLE` | **deleted** |
| `EXTENSIONS_REMOVE` | **deleted** |
| new `EXTENSIONS_OPEN_PAGE` | deep-links to the browser's extensions page |

The preload contract changes: `EXTENSIONS_TOGGLE` and `EXTENSIONS_REMOVE`
are removed from the type definitions and the IPC handler map. This is a
breaking change for the renderer, which must be updated to remove the
toggle and remove UI.

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

Windows acceptance, run by the owner:

1. Install Chrome and Firefox with at least 2 extensions each
2. Run the scan — confirm all extensions appear with correct name, version and enabled state
3. Toggle an extension in the browser's own UI, re-scan — confirm the state changed
4. Click "Manage" on an extension — confirm the browser's extensions page opens

---

## Risks

| Risk | Mitigation |
|---|---|
| Browser profile path varies by installation | Detect by checking known profile directory patterns; degrade to "not found" rather than guessing |
| Schema change in `Preferences` or `extensions.json` | Tolerate unknown/missing fields; report `null`; never throw |
| Running browser holds file open | Read is still possible on Windows (shared read); if read fails, report unavailable |
| A contributor "fixes" the missing toggle | This document's "Why this module cannot write" section is the guard — it carries the HMAC and file-rebuild evidence from ROADMAP §6 |
| Deep link opens wrong browser | Each browser has its own URL scheme; `chrome://` opens Chrome, `edge://` opens Edge, etc. If the browser is not the default, the URL scheme still routes to the correct browser if installed |
