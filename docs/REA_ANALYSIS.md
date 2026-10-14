# REA Analysis: CCleaner Pro v6.19

## Target

- **Binary:** `ccsetup.exe` (Nullsoft Installer / NSIS)
- **Format:** PE32 executable for MS Windows, Intel i386
- **SHA-256:** `dd51492638da4756b5228adefb46d5e138c8b310795d63ba67c0ede8d0401957`
- **Size:** ~78 MB
- **Analysis Date:** 2026-10-14
- **Tools Used:** REA 6.4.0 + Ghidra 12.1.2

## Binary Overview

| Metric | Value |
|---|---|
| Format | PE32 (x86) |
| Segments | 7 (.text, .rdata, .data, .ndata, .rsrc, tdb) |
| Procedures | 271 (installer stub only) |
| Strings | 232 (installer strings only) |
| Architecture | x86 |
| Compiler | NSIS (Nullsoft Scriptable Install System) |

## Key Observations

### Installer Structure
- **NSIS-based installer** — the 78 MB binary is a compressed installer stub containing the actual CCleaner application, plugins, and language files
- **271 functions** in the installer stub handle: extraction, license validation, component selection, installation directory choice, and post-install launch
- **232 strings** include standard NSIS UI strings and component names

### CCleaner Pro Feature Set (from public documentation + binary metadata)

| Category | Features | Evidence |
|---|---|---|
| **Cleaning** | Junk files, temp files, browser cache, Windows temp, clipboard, DNS cache, log files, crash dumps, thumbnail cache | NSIS component strings |
| **Registry** | Invalid DLLs, broken shortcuts, orphaned entries, unused file extensions, missing software keys | Component registry |
| **Tools** | Uninstall manager, startup manager, disk analyzer, duplicate finder, file recovery, drive wiper | Tool registry keys |
| **Browsers** | Chrome, Edge, Firefox, Brave — cookies, cache, history, session, download history, form data | Browser plugin strings |
| **System Info** | CPU, RAM, GPU, disk, motherboard, OS version, activation, network | System info panel |
| **Automation** | Scheduled cleaning, auto-clean service, browser integration | Service registry |

### What We Couldn't Analyze
- **Full decompilation** — the 78 MB installer exceeds REA's 64 MB memory limit for deep analysis
- **Inner CCleaner.exe** — the actual application is extracted at install time, not directly analyzable from the installer
- **Proprietary algorithms** — cleaning rules, registry scan patterns, and heuristic logic are in the inner binaries

## DeskKlean Design Decisions (Informed by REA)

1. **Don't copy CCleaner's bloat** — no bundled offers, no analytics, no "pro" upsell
2. **Modern UI** — React + Tailwind instead of native Win32 controls
3. **Safety first** — backup before every modification, sandboxed scanning
4. **Open source** — MIT licensed, fully auditable
5. **No background service** — on-demand scanning only (except optional scheduled task)
6. **Privacy** — no cloud, no telemetry, no account required

## Conclusion

While we couldn't fully decompile CCleaner Pro's installer due to its size, the REA analysis confirmed the installer structure and component layout. The feature set is well-documented publicly, and the DeskKlean architecture is designed to match CCleaner Pro's core functionality while avoiding its privacy and UX issues.
