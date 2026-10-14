# DeskKlean — Design Decisions (resolved)

Source: requirements-gathering session, resolved via the `grilling` design-tree method.
Status: **COMPLETE** — design tree exhausted, no open questions (Q1–Q23).

---

## Platform & stack

| # | Decision | Resolution |
|---|---|---|
| Q1 | Platform target | **Windows only.** The reference product is Windows-exclusive; staying focused avoids cross-platform tax. |
| Q2 | Stack | **Electron + React + TypeScript** (Vite 5, Tailwind CSS 4 via PostCSS). |
| Q3 | Audience / licence | **Public release, MIT.** Consistent with the author's other public repos. |
| Q16 | Language | **English only** at launch. i18n deferred until there's demand. |

## Distribution

| # | Decision | Resolution |
|---|---|---|
| Q4 | Installer formats | **NSIS installer + portable `.exe`.** |
| Q5 | Auto-update | **electron-updater + GitHub Releases.** Zero infrastructure. |
| Q9 | Code signing | **Self-signed initially.** EV certificate deferred (needs a registered entity + cost). |
| Q18 | Update channels | **Stable + beta toggle in Settings.** No separate install required. |

## Runtime model

| # | Decision | Resolution |
|---|---|---|
| Q6 | Background behaviour | **On-demand scanning only.** Scheduled cleaning rides Windows Task Scheduler. No always-on service. |
| Q15 | Tray | **Minimise to tray + notification on scan completion.** |
| Q10 | Safety | **Always back up before modifying anything.** Registry backups + recycle-bin-based file removal. |

## Feature behaviour

| # | Decision | Resolution |
|---|---|---|
| Q8a | Health Check | **Per-category scans with individual fix controls** (not one opaque one-click fix). |
| Q8b | Smart Clean | **Built-in rules + user-defined custom rules** (paths/patterns). |
| Q8c | Registry Fixer | **Auto-fix "safe" entries** (missing DLLs, unused extensions, broken shortcuts). **"Medium risk" requires explicit confirmation.** |
| Q8d | Startup Optimizer | **Registry Run/RunOnce + Startup folder + scheduled tasks. Services excluded** (too risky). |
| Q8e | App Remover | **Standard uninstaller + post-uninstall leftover scanner** (files, folders, registry remnants). |
| Q8f | Disk Analyzer | **Treemap + file-type breakdown** (treemap alone can't find a specific large file). |
| Q8g | Duplicate Finder | **Hash-based detection + image preview before delete.** No byte-by-byte comparison. |
| Q11 | Extension Manager | **Chrome + Edge + Firefox.** Brave excluded — Chrome-based, same extension store. |
| Q14 | Health Check browsers | **Chrome + Edge + Firefox** (same set as Q11). |
| Q17 | Smart Clean categories | **Windows core** (temp, recycle bin, log files, thumbnail cache) **+ browser cache.** **Excluded: DNS cache** (fragile) **and crash dumps** (rarely large). |

## Secure Erase

| # | Decision | Resolution |
|---|---|---|
| Q12a | File / free-space shredding | **Quick 1-pass + DoD 5220.22-M 3-pass.** **Gutmann 35-pass excluded** — designed for 1996 MFM/RLL drives; offering it implies it does something. |
| Q12b | Whole-drive wipe | **Detect drive type.** SSD → **ATA Secure Erase / NVMe Format** (firmware-level, seconds). HDD → overwrite passes. Rationale: on an SSD, wear levelling means overwrite passes may never touch the original cells — overwrite-based wiping *looks* secure and isn't. |

## Settings

| # | Decision | Resolution |
|---|---|---|
| Q7 | Theme | **Dark only** (primary). Light mode is a later addition. |
| Q13a | Exclusion list | **Yes — user-managed, from launch.** Safety valve for false positives. |
| Q13b | Proxy | **Inherit the Windows system proxy.** Only auto-update uses the network; Electron picks this up automatically. |
| Q13c | Power-saver | **Skipped.** No background service means nothing to throttle. Revisit only if a service lands. |
| Q13d | Settings surface | **Tabbed:** General / Cleaning / Updates / Exclusions / Advanced. |

---

## Build & release

| # | Decision | Resolution |
|---|---|---|
| Q19 | Build pipeline | **GitHub Actions on `windows-latest`.** Reproducible installer attached to every release, no Windows box in the loop; the local Windows copy stays a dev sandbox. Cross-building a Windows NSIS target from Linux is possible but native modules and code signing behave badly. |
| Q20 | Release artifacts | **NSIS installer + portable `.exe`.** No unpacked ZIP — a third artifact to maintain for no user benefit. |
| Q21 | Versioning | **Manual semver + `CHANGELOG.md`.** Automation (changesets / release-please) is overhead at solo-project scale. |
| Q22 | Repository | **Public, `chairielazizi/deskklean`, MIT.** |
| Q23 | App icon | **Placeholder for v0.1.** Not a functional blocker; generate a real one on request. |

### Cost note (Q19)

GitHub Actions is **free for public repositories using standard GitHub-hosted runners** — no
minute quota, Windows included. Per GitHub's billing docs:

> "GitHub Actions usage is free for self-hosted runners and for public repositories that use
> standard GitHub-hosted runners."

The paid path applies only to **private** repos (Windows 2-core at $0.010/min against the
2,000 min/month GitHub Free allowance). **Larger runners are always billed**, even on public
repos — so the workflow must pin `runs-on: windows-latest`, not a larger runner.

Caveat: self-signed code signing (Q9) means **SmartScreen warnings** on install. A UX cost,
not a dollar cost.


## Known build state

The `@tailwindcss/vite` plugin is deliberately **not** used — it is ESM-only, and this
project's `vite.config.ts` loads as CJS (no `"type": "module"`). Tailwind runs through
`@tailwindcss/postcss` instead. See `FIX-NOTES.md`.
