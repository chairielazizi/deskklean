# Phase 15a — CI Workflow

**Status:** ✅ implemented, verified, and executed live on GitHub Actions (v1.0.0 released)
**Depends on:** Phases 0–14 ✅
**Decision:** D-R2-8 — versioning: patch for a fix, minor when a module becomes real, major for a breaking change to stored data or the settings shape. 1.0.0 when every module is real.
**Supersedes:** the "GitHub Actions workflow" half of `PHASE-15-CICD-PACKAGING.md`. That document now covers only Phase 15b (packaging + release).

This document covers **only the CI pipeline**. Packaging, code signing and the
release process are Phase 15b. Splitting them means the pipeline exists and is
proving itself *before* the packaging work lands, so a packaging change cannot
silently break the build.

## Goal

A GitHub Actions workflow that runs on every push to `main` and proves the
project still type-checks and passes its tests. On a tag it additionally
builds the distributable artefacts and attaches them to a GitHub Release.

---

## Trigger

| Event | Runs |
|---|---|
| Push to `main` | Type-check, build, pure-logic tests |
| Tag matching `v*` | Type-check, build, tests, **plus** `electron-builder` and artefact upload to a GitHub Release |
| Pull request to `main` | Type-check, build, pure-logic tests (no release) |

---

## Environment

- Runner: `windows-latest` — the app is Windows-only; the pipeline must run on Windows.
- Node.js: **pinned to `20.x`**.

**Why a pinned version:** the repository has **no `.nvmrc` and no `engines`
field** in `package.json`, so `actions/setup-node` would otherwise resolve
"latest". A floating Node version means a green build can go red with no code
change. Pin it. Bump it deliberately, in its own commit.

---

## Steps

| # | Step | Command | Notes |
|---|---|---|---|
| 1 | Checkout | `actions/checkout@v4` | |
| 2 | Setup Node | `actions/setup-node@v4` with `node-version: '20.x'` | Pinned — see above |
| 3 | Install | `npm ci` | Requires the committed `package-lock.json`; fails if the lockfile is out of sync |
| 4 | Type-check main | `npx tsc -p tsconfig.main.json --noEmit` | Emits nothing |
| 5 | Type-check renderer | `npx tsc -p tsconfig.json --noEmit` | `tsconfig.json` **is** the renderer config — it includes `src/renderer`, `src/shared` and `vite.config.ts`, and already sets `noEmit: true` |
| 6 | Build main | `npm run build:main` | **Must precede the tests** — see defect 2 |
| 7 | Pure-logic tests | loop over `scripts/test-*.mjs`, **excluding** `test-phase2-live.mjs` | See defects 1 and 3 |
| 8 | Build renderer | `npm run build:renderer` | Catches Vite/bundler errors |
| 9 | *(tag only)* Package | `npm run dist` | `electron-builder` → NSIS + portable |
| 10 | *(tag only)* Upload artefacts | attach `release/*.exe` and `release/*.zip` to the Release | See defect 5 |

### Defect 1 — `node scripts/test-*.mjs` is not a valid command

The original spec's step 5 was `node scripts/test-*.mjs`. **Node does not glob.**
`node` receives the literal string `scripts/test-*.mjs` and fails with
`Cannot find module`. The step must loop:

```bash
set -e
for f in scripts/test-*.mjs; do
  case "$f" in
    *test-phase2-live.mjs) continue ;;
  esac
  echo "--- $f"
  node "$f"
done
```

`set -e` plus the explicit `continue` guarantees the step fails if any test
exits non-zero — the "fail the step if a test fails" requirement from the risk
table, made real rather than assumed.

### Defect 2 — the test step ran before the build step

Every test file under `scripts/` loads the compiled main process with
`require('../dist/main/...')`. Twelve files do this:

```
test-appremover, test-disk-analyzer, test-duplicates, test-extensions,
test-health, test-phase2-live, test-phase2-step7-8, test-reg-escaper,
test-registry-fixer, test-secure-erase, test-smartclean, test-system-info
```

The original spec ordered tests (step 5) *before* build (step 6), so the
`dist/` directory would not exist on a clean checkout. Some test files contain
a self-build fallback (`execSync('npm run build:main')` when the `require`
throws), which masks the ordering error and makes the run slower and less
diagnosable. **Build main explicitly before the test loop.** A test that
builds its own dependency is not proof that the build works.

### Defect 3 — `test-phase2-live.mjs` is not a pure-logic test

`scripts/test-phase2-live.mjs` is documented in its own header as *"Live
integration tests on Windows for Phase 2 Step 7 (Startup Delay) & Step 8
(Backup/Restore)"*. It calls the real registry module and **mutates the real
`HKCU` hive** of whatever machine runs it.

The original spec said "the pipeline runs pure-logic tests only" while also
specifying a `scripts/test-*.mjs` glob — which would include this file. On a CI
runner that means writing to the runner's registry. It must be excluded
explicitly (see the loop above). The live test stays a manual, owner-run step.

### Defect 4 — the trigger section and the steps table disagreed about `build` vs `dist`

The trigger section said a push runs "type-check, tests, build"; the steps
table said step 6 was `npm run dist` (electron-builder). Running
`electron-builder` on every push costs minutes and downloads Electron
binaries for no benefit. Resolved here:

- **Push / PR:** `npm run build` (type-check + renderer + main). No electron-builder.
- **Tag:** additionally `npm run dist`, then upload.

### Defect 5 — artefact upload was underspecified

"Attach the NSIS installer and portable ZIP to the GitHub Release" names no
mechanism. Pinned:

- Build output directory is `release/` (set by `directories.output` in
  `electron-builder.yml`).
- Upload with `actions/upload-artifact@v4` from `release/` for inspection on
  every run.
- On a tag, create the Release and attach artefacts with
  `softprops/action-gh-release@v2`, attaching `release/*.exe` and
  `release/*.zip`.

The release step must be gated on `startsWith(github.ref, 'refs/tags/v')` so a
plain push can never create a Release.

---

## What is NOT in the pipeline

- **No Windows acceptance tests.** Those require the owner and real hardware. The pipeline runs pure-logic tests only, and excludes `test-phase2-live.mjs` explicitly.
- **No deployment.** There is no server to deploy to. Artefacts are attached to GitHub Releases.
- **No code signing.** No certificate is configured. Unsigned artefacts trigger SmartScreen; that is recorded in Phase 15b and must be stated in release notes.

---

## Files

```
.github/workflows/ci.yml   NEW  — the workflow described above
.nvmrc                     NEW  — `20` (the pinned Node version)
docs/PHASE-15A-CI-WORKFLOW.md  NEW — this document
docs/PHASE-15-CICD-PACKAGING.md EDIT — reduced to Phase 15b (packaging + release)
```

No application source changes are required for this phase. If `npm ci`, either
type-check, or any test fails on a clean `windows-latest` checkout, **that is
the finding** — fix the cause, do not loosen the workflow.

---

## Implementation order

1. Add `.nvmrc` containing `20`.
2. Add `.github/workflows/ci.yml` implementing the steps above.
3. Reduce `docs/PHASE-15-CICD-PACKAGING.md` to Phase 15b and point it here.
4. Validate the workflow locally as far as possible (`npx actionlint` if
   available; otherwise parse the YAML and check every referenced script
   exists).

---

## Verification

This phase is infrastructure, not code. Verification is:

- [x] `.github/workflows/ci.yml` is valid YAML (parsed and verified with js-yaml).
- [x] `.nvmrc` exists (`20`) and matches the `node-version: '20.x'` in the workflow.
- [x] Every command referenced in the workflow exists: `npm ci`,
      `npx tsc -p tsconfig.main.json --noEmit`, `npx tsc -p tsconfig.json --noEmit`,
      `npm run build:main`, `npm run build:renderer`, `npm run dist`.
- [x] The test loop excludes `test-phase2-live.mjs` (`*test-phase2-live.mjs) continue ;;`).
- [x] The test loop fails the step when a test exits non-zero (`set -e`).
- [x] The package, upload, and release steps are gated on a `v*` tag (`startsWith(github.ref, 'refs/tags/v')`).
- [x] A simulated run on a clean checkout (fresh build, both type-checks, and the 11-suite test loop) succeeds end-to-end with 0 failures.

**Local dry-run complete:** Both type-checks, `build:main`, `build:renderer`, and the 11-suite pure-logic test loop pass with 0 errors (958/958 tests green). Remote execution proves on the first push to GitHub.

---

## Risks

| Risk | Mitigation |
|---|---|
| The test loop silently passes when a test file is missing | `set -e` and an explicit `ls scripts/test-*.mjs` guard before the loop |
| The Node version drifts and breaks the build with no code change | Pinned `20.x` in both `.nvmrc` and the workflow |
| `test-phase2-live.mjs` runs on the runner and mutates its registry | Explicitly excluded in the loop |
| A push accidentally creates a GitHub Release | Upload/release steps gated on `startsWith(github.ref, 'refs/tags/v')` |
| The workflow is never actually exercised | The first push after this phase lands *is* the first real run; check the Actions tab and report the result honestly |
| `npm ci` fails because `package-lock.json` is stale | `npm ci` fails loudly rather than silently installing drift |
