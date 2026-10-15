# Phase 15 — CI/CD, Packaging and Releases

**Status:** 🔜 specified, not built
**Depends on:** All prior phases. This phase does not add a feature; it adds the pipeline that delivers the product.
**Decision:** D-R2-8 — versioning: patch for a fix, minor when a module becomes real, major for a breaking change to stored data or the settings shape. 1.0.0 when every module is real. Each phase ends with a tag and a release.

## Goal

Establish the CI/CD pipeline, electron-builder packaging targets and release
process for DeskKlean. This phase covers:

1. A GitHub Actions workflow on `windows-latest` that type-checks, runs
   pure-logic tests, and builds the app.
2. electron-builder targets (NSIS installer + portable) and what the
   portable target implies for runtime paths.
3. Code signing and what happens without it.
4. The versioning and release process per D-R2-8.

No CI or packaging step has been run. This document specifies what the
pipeline will do; it does not claim any of it has worked.

---

## Versioning (D-R2-8)

| Bump | Trigger |
|---|---|
| Patch | A fix to existing behaviour |
| Minor | A module becomes real (from mock to real) |
| Major | A breaking change to stored data or the settings shape |
| 1.0.0 | Every module is real |

Version is stored in `package.json` and mirrored in the app's settings
schema. Tags follow `v<semver>` (e.g. `v0.2.0`). Each phase ends with a
tag and a GitHub Release.

---

## GitHub Actions workflow

### Trigger

- On every push to `main`: run the pipeline (type-check, tests, build).
- On every tag matching `v*`: run the pipeline and additionally create a
  GitHub Release with the built artefacts.

### Environment

- Runner: `windows-latest` — the app is Windows-only; the pipeline must
  run on Windows.
- Node.js: the version specified in `.nvmrc` or `package.json`.

### Steps

| Step | What it does |
|---|---|
| 1. Checkout | `actions/checkout@v4` |
| 2. Setup Node | `actions/setup-node@v4` with the Node version |
| 3. Install dependencies | `npm ci` |
| 4. Type-check | `npx tsc --noEmit` for both `tsconfig.main.json` and `tsconfig.renderer.json` |
| 5. Pure-logic tests | `node scripts/test-*.mjs` — every `scripts/test-*.mjs` file |
| 6. Build | `npm run dist` — electron-builder produces NSIS installer + portable |
| 7. Upload artefacts | On tag: attach NSIS installer and portable ZIP to the GitHub Release |

### What is NOT in the pipeline

- **No Windows acceptance tests.** Those require the owner and real
  hardware. The pipeline runs pure-logic tests only.
- **No deployment.** There is no server to deploy to. The artefacts are
  attached to GitHub Releases.

---

## electron-builder targets

### NSIS installer

The primary distribution target. Produces a `.exe` installer that:

- Installs to `%LOCALAPPDATA%\Programs\DeskKlean` (per-user, no admin required — this is the electron-builder NSIS default).
- Creates Start Menu and desktop shortcuts.
- Offers an optional desktop icon.

### Portable target

Produces a `.zip` containing a self-extracting portable build. The
portable build **extracts to a temporary directory at runtime** and runs
the executable from there. This has a critical implication:

**`process.execPath` in a portable build points at the extracted
executable in the temp directory, not at the original archive.** When
the app exits, the temp directory is deleted, so the path recorded in
`process.execPath` becomes invalid.

electron-builder sets the `PORTABLE_EXECUTABLE_FILE` environment variable
to the path of the original portable executable (the one the user
double-clicked). This is the stable path; `process.execPath` is not.

**Implications:**

- The elevation relaunch code (Phase 2) must use
  `process.env.PORTABLE_EXECUTABLE_FILE` when set, falling back to
  `process.execPath` otherwise.
- Any code that persists the app's own path (e.g. for a "check for
  updates" feature) must use `PORTABLE_EXECUTABLE_FILE`, not
  `process.execPath`.
- The Phase 2 elevation code already distinguishes packaged from
  unpackaged; it must now also distinguish portable from
  NSIS-installed.

**UNVERIFIED:** The exact temp directory name and lifecycle of the
portable extraction may vary by electron-builder version. The
implementation must test this on the target machine.

---

## Code signing

### What happens without a code signature

Windows SmartScreen shows a blue "Windows protected your PC" warning when
running an unsigned executable. The user must click "More info" → "Run
anyway" to proceed. This warning appears for both the NSIS installer and
the portable build.

The warning is not a one-time thing — it can reappear on each launch until
the reputation system learns the binary, which requires significant install
volume. For a small project, the warning is effectively permanent without
a code-signing certificate.

### Options

| Option | Cost | Effect |
|---|---|---|
| No certificate | Free | SmartScreen warning on every launch |
| Self-signed certificate | Free | SmartScreen still warns (the cert is not trusted by Microsoft) |
| OV certificate (OV code signing) | ~$100–300/year | SmartScreen warning reduced or eliminated after reputation builds |
| EV certificate (EV code signing) | ~$300–500/year | SmartScreen warning eliminated immediately |

**OPEN QUESTION:** Whether to purchase a code-signing certificate, and
which type, is the owner's decision. It depends on the project's
distribution goals and budget. This phase does not decide it; it records
the trade-off.

### If no certificate is purchased

The build succeeds without signing. The artefacts are valid; they just
trigger SmartScreen. The release notes must state this plainly so users
are not surprised.

---

## Open question: `requireAdministrator` manifest (OQ-5)

Recorded as an open option, not a decision.

A packaged production build could declare `requireAdministrator` in its
application manifest so Windows prompts for elevation before the process
starts. This would replace the Phase 2 relaunch code entirely.

**Why this cannot work in development:**

- Dev mode runs `electron.exe` (the Electron runtime), not the app's own
  binary. The manifest of `electron.exe` is controlled by Electron, not
  by DeskKlean. We cannot add `requireAdministrator` to it.
- Therefore the relaunch code is required for development regardless of
  what the packaged build does.

**Trade-off recorded in Phase 2:**

| | `requireAdministrator` manifest | Relaunch at runtime |
|---|---|---|
| Packaged build | Prompts at launch, always elevated | Prompts at launch, user can decline |
| Development | Does not work (wrong binary) | Works |
| "Continue without admin" option | Not available | Available |
| Read-only browsing | Not available without elevation | Available when declined |

This remains an open question. The relaunch code is built and works in both
modes. Switching to a manifest at packaging time would remove the
"continue without administrator" option and would still require the
relaunch code for development. Whether that trade-off is worth it is the
owner's call.

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
- [ ] Both `tsc` configs clean
- [ ] All `scripts/test-*.mjs` pass
- [ ] Build produces NSIS + portable artefacts
- [ ] Release notes written, including honest statements about what is still mock
- [ ] If a code-signing certificate is configured, artefacts are signed
- [ ] If no certificate, release notes state that SmartScreen will warn

---

## Files

```
.github/workflows/ci.yml       NEW  — GitHub Actions workflow
electron-builder.yml (or package.json 'build' key)  EDIT — portable target config,
                                                      NSIS config
scripts/test-*.mjs               (existing) — must all pass in CI
```

---

## Implementation order

1. GitHub Actions workflow — checkout, setup, install, type-check, tests, build.
2. electron-builder portable target config — ensure `PORTABLE_EXECUTABLE_FILE` is respected.
3. Release process documentation — the checklist above becomes the template for each release.

---

## Verification

This phase is infrastructure, not code. Verification is:

- The workflow file is valid YAML.
- The workflow file references the correct scripts (`scripts/test-*.mjs`).
- The electron-builder config produces both targets.
- The release checklist is followed for the first tagged release.

**Nothing in this phase has been run.** The pipeline is specified, not
proven. The first real run will be on the first tagged release.

---

## Risks

| Risk | Mitigation |
|---|---|
| Portable build's `process.execPath` breaks elevation | Use `PORTABLE_EXECUTABLE_FILE` env var; test on target machine |
| electron-builder portable extraction path varies | Test on target machine; do not hard-code temp paths |
| CI fails silently (tests not actually run) | The workflow must fail the step if any test exits non-zero |
| Unsigned build triggers SmartScreen alarm | State this in release notes; consider a certificate if the project matures |
| Version bumps are forgotten | The release checklist enforces it; CI could check that `package.json` matches the tag |
