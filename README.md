# DeskKlean

**Windows Desktop System Cleanup & Optimization Tool**

A modern, privacy-respecting desktop application for Windows that cleans junk files, manages startup items, cleans the registry, and optimizes system performance.

---

## Feature Map — DeskKlean vs Commercial Cleaners

| Commercial Feature | DeskKlean Equivalent | Status |
|---|---|---|
| Health Check (one-click scan) | One-Click Clean | Planned |
| Custom Clean (junk/temp/cache) | Smart Clean | Planned |
| Registry Cleaner | Registry Fixer | Planned |
| Startup Manager | Startup Optimizer | Planned |
| Uninstall Manager | App Remover | Planned |
| Browser Plugins Manager | Extension Manager | Planned |
| Disk Analyzer | Disk Space Analyzer | Planned |
| Duplicate Finder | Duplicate File Finder | Planned |
| File Recovery | Undelete Tool | Planned |
| Drive Wiper | Secure Erase | Planned |
| System Info | System Info Panel | Planned |
| Scheduled Cleaning | Task Scheduler Integration | Planned |

---

## Architecture

- **Framework:** Electron 28 + React 18 + Vite 5 + TypeScript
- **Backend:** Node.js native modules + PowerShell integration
- **UI:** Tailwind CSS 4 + Framer Motion + Lucide Icons

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for full architecture.
See [docs/DESIGN-DECISIONS.md](docs/DESIGN-DECISIONS.md) for the resolved design spec.

---

## Reference Product Analysis

See [docs/REA_ANALYSIS.md](docs/REA_ANALYSIS.md) for the reverse-engineering analysis of a leading commercial cleaner's installer.

---

## License

MIT
