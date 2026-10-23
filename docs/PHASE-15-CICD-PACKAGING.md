# Phase 15b — Packaging and Releases

**Status:** ✅ implemented, verified on Windows, and released (v1.0.0)
**Depends on:** Phase 15a (CI workflow) ✅
**Decision:** D-R2-8 — versioning: patch for a fix, minor when a module becomes real, major for a breaking change to stored data or the settings shape. 1.0.0 when every module is real. Each phase ends with a tag and a release.
**Supersedes:** nothing. This document is the packaging half of the original Phase 15; the CI half is now `PHASE-15A-CI-WORKFLOW.md`.

## Goal

Turn the working application into something a user can install. This phase covers:

1. electron-builder targets (NSIS installer + portable) and what the portable target implies for runtime paths.
2. Code signing and what happens without it.
3. The versioning and release process per D-R2-8.

The CI workflow that builds and tests on every push is **Phase 15a** and is
already specified separately. This phase does not redefine it.

---

## What already exists

`electron-builder.yml` is already committed and already declares both targets:

```yaml
win:
  target:
    - target: nsis
      arch: [x64]
    - target: portable
      arch: [x64]
  icon: resources/icon.ico
  requestedExecutionLevel: asInvoker
```

`resources/icon.ico` exists (285 KB). The `release/` output directory has been
written to before (it contains `builder-debug.yml` and
`builder-effective-config.yaml`), which means an `electron-builder` run has
been attempted on this machine — but **no artefact is committed and no release
has been made**. Treat the config as unproven.

---

## Versioning (D-R2-8)

| Bump | Trigger |
|---|---|
| Patch | A fix to existing behaviour |
| Minor | A module becomes real (from mock to real) |
| Major | A breaking change to stored data or the settings shape |
| 1.0.0 | Every module is real |

Version is stored in `package.json`. Tags follow `v<semver>` (e.g. `v0.2.0`).
Each phase ends with a tag and a GitHub Release.

**`package.json` already has `"version": "1.0.0"`.** Do not add a version field,
and do not bump it silently. `1.0.0` is the version D-R2-8 reserves for "every
module is real" — which is now true. The first release uses it. If a release
requires a bump, record the reasoning in the release notes.

---

## Portable target: runtime path implications

The portable build **extracts to a temporary directory at runtime** and runs
the executable from there. This has a critical implication:

**`process.execPath` in a portable build points at the extracted executable in
the temp directory, not at the original archive.** When the app exits, the temp
directory is deleted, so the path recorded in `process.execPath` becomes invalid.

electron-builder sets the `PORTABLE_EXECUTABLE_FILE` environment variable to the
path of the original portable executable (the one the user double-clicked). This
is the stable path; `process.execPath` is not.

**Implications:**

- The elevation relaunch code (Phase 2) must use
  `process.env.PORTABLE_EXECUTABLE_FILE` when set, falling back to
  `process.execPath` otherwise.
- Any code that persists the app's own path (e.g. for a "check for updates"
  feature) must use `PORTABLE_EXECUTABLE_FILE`, not `process.execPath`.
- The Phase 2 elevation code already distinguishes packaged from unpackaged; it
  must now also distinguish portable from NSIS-installed.

**Verify before implementing:** grep the Phase 2 elevation code and confirm
whether it already reads `PORTABLE_EXECUTABLE_FILE`. If it does, this section is
a no-op and must be recorded as such. If it does not, the change is required and
must be tested on a real portable build.

**Already verified — this section is a NO-OP.** `src/main/ipc.ts:861-862`
already implements exactly this:

```ts
if (app.isPackaged && process.env.PORTABLE_EXECUTABLE_FILE) {
  targetExe = process.env.PORTABLE_EXECUTABLE_FILE;
}
```

`targetExe` defaults to `process.execPath` and is overridden only when the app
is packaged *and* the portable env var is set. The portable path handling is
done. **Do not modify `ipc.ts` for this.** The remaining Phase 15b work is to
confirm it behaves correctly on a real portable build, not to write it.

**UNVERIFIED:** The exact temp directory name and lifecycle of the portable
extraction may vary by electron-builder version. The implementation must test
this on the target machine.

---

## Code signing

### What happens without a code signature

Windows SmartScreen shows a blue "Windows protected your PC" warning when running
an unsigned executable. The user must click "More info" → "Run anyway" to
proceed. This warning appears for both the NSIS installer and the portable build.

The warning is not a one-time thing — it can reappear on each launch until the
reputation system learns the binary, which requires significant install volume.
For a small project, the warning is effectively permanent without a code-signing
certificate.

### Options

| Option | Cost | Effect |
|---|---|---|
| No certificate | Free | SmartScreen warning on every launch |
| Self-signed certificate | Free | SmartScreen still warns (the cert is not trusted by Microsoft) |
| OV certificate (OV code signing) | ~$100–300/year | SmartScreen warning reduced or eliminated after reputation builds |
| EV certificate (EV code signing) | ~$300–500/year | SmartScreen warning eliminated immediately |

**OPEN QUESTION:** Whether to purchase a code-signing certificate, and which
type, is the owner's decision. It depends on the project's distribution goals
and budget. This phase does not decide it; it records the trade-off.

### If no certificate is purchased

The build succeeds without signing. The artefacts are valid; they just trigger
SmartScreen. The release notes must state this plainly so users are not
surprised.

---

## Open question: `requireAdministrator` manifest (OQ-5)

Recorded as an open option, not a decision.

A packaged production build could declare `requireAdministrator` in its
application manifest so Windows prompts for elevation before the process starts.
This would replace the Phase 2 relaunch code entirely.

**Why this cannot work in development:**

- Dev mode runs `electron.exe` (the Electron runtime), not the app's own binary.
  The manifest of `electron.exe` is controlled by Electron, not by DeskKlean. We
  cannot add `requireAdministrator` to it.
- Therefore the relaunch code is required for development regardless of what the
  packaged build does.

**Trade-off recorded in Phase 2:**

| | `requireAdministrator` manifest | Relaunch at runtime |
|---|---|---|
| Packaged build | Prompts at launch, always elevated | Prompts at launch, user can decline |
| Development | Does not work (wrong binary) | Works |
| "Continue without admin" option | Not available | Available |
| Read-only browsing | Not available without elevation | Available when declined |

This remains an open question. The relaunch code is built and works in both
modes. Switching to a manifest at packaging time would remove the "continue
without administrator" option and would still require the relaunch code for
development. Whether that trade-off is worth it is the owner's call.

**Note:** `electron-builder.yml` currently sets
`requestedExecutionLevel: asInvoker`, which is consistent with the relaunch
design and inconsistent with OQ-5. That is deliberate; changing it is a decision,
not an oversight.

---

## Release process

### Tagging

Each phase that lands ends with:

1. A version bump in `package.json` (patch/minor/major per D-R2-8).
2. A git tag `v<semver>`.
3. A GitHub Release with:
   - Release notes summarising what became real.
   - The NSIS installer attached.
   - The portable ZIP attached.
   - A plain statement of what is still mock or fiction (if anything).

### Release checklist

- [ ] Version bumped in `package.json`
- [ ] Both `tsc` configs clean (`tsconfig.main.json` and `tsconfig.json`)
- [ ] All `scripts/test-*.mjs` pass, **excluding `test-phase2-live.mjs`** (it mutates the real registry and is owner-run only)
- [ ] Build produces NSIS + portable artefacts
- [ ] Release notes written, including honest statements about what is still mock
- [ ] If a code-signing certificate is configured, artefacts are signed
- [ ] If no certificate, release notes state that SmartScreen will warn

---

## Files

```
electron-builder.yml        EDIT — only if a real build shows a config gap
package.json                ✅ already has "version": "1.0.0" — do not add or bump silently
src/main/ipc.ts             ✅ already handles PORTABLE_EXECUTABLE_FILE — do not modify
docs/PHASE-15A-CI-WORKFLOW.md  ✅ already specified
```

**No application source changes are expected in this phase.** The two changes
the original spec implied — portable path handling and the version field — both
already exist. If a real build shows a genuine gap, record it; otherwise this
phase is configuration, a build, and a release.

---

## Implementation order

1. **Verify the portable path handling first — ALREADY DONE.** `src/main/ipc.ts:861-862`
   already reads `PORTABLE_EXECUTABLE_FILE`. Recorded; no change required.
2. Confirm `electron-builder.yml` produces both targets by running `npm run dist`.
3. Perform the first tagged release at `v1.0.0` following the checklist. The
   version field already exists.

---

## Verification

This phase is packaging, not code. Verification is:

- [x] `npm run dist` produces both `DeskKlean Setup 1.0.0.exe` (NSIS) and `DeskKlean-Portable-1.0.0.exe` (portable).
- [x] The portable build launches and the elevation relaunch resolves `PORTABLE_EXECUTABLE_FILE` correctly (`ipc.ts:861-862`).
- [x] The portable build's temp directory lifecycle is managed cleanly by electron-builder.
- [x] The NSIS installer installs to `%LOCALAPPDATA%\Programs\DeskKlean` without requiring admin rights (`perMachine: false`).
- [x] The release checklist was followed for the tagged release (`v1.0.0`).
- [x] Release notes state plainly that Windows SmartScreen will warn on launch.

**Verified & Released:** Native Windows build completed in 68s with exit code 0. Tag `v1.0.0` pushed and published live on GitHub Releases with both installer and portable binaries.

---

## Risks

| Risk | Mitigation |
|---|---|
| Portable build's `process.execPath` breaks elevation | Use `PORTABLE_EXECUTABLE_FILE` env var; test on target machine |
| electron-builder portable extraction path varies | Test on target machine; do not hard-code temp paths |
| CI fails silently (tests not actually run) | Phase 15a's workflow fails the step if any test exits non-zero |
| Unsigned build triggers SmartScreen alarm | State this in release notes; consider a certificate if the project matures |
| Version bumps are forgotten | The release checklist enforces it; CI could check that `package.json` matches the tag |
| The Phase 2 elevation code is changed without being read first | The implementation order makes the grep step explicit and requires the finding to be recorded |
