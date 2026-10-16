# Phase 1 — System Info returns real data

**Status:** ✅ implemented · type-and-logic verified on Linux · Windows acceptance passed
**Plan position:** Phase 1 of 15 — see `docs/ROADMAP.md`
**Phase file:** this document
**Supersedes:** the Phase 1 section of `docs/SYSTEM-DATA-PHASES.md`

---

## Goal

`SYSTEM_GET_SPECS` previously invented its drive list (512 GB / 1 TB), GPU
(RTX 4070 Ti), motherboard (ROG STRIX Z790-E), CPU temperature, RAM speed/type
and OS build. `SYSTEM_GET_TELEMETRY` used `Math.random()` for cpu, diskRead and
diskWrite. Both now read from the machine.

## What was replaced

| Section | Source |
|---|---|
| OS | `Win32_OperatingSystem` + `SoftwareLicensingProduct` |
| CPU | `Win32_Processor`, `Win32_PerfFormattedData_PerfOS_Processor`, `MSAcpi_ThermalZoneTemperature` |
| Memory | `Win32_PhysicalMemory` + `os.totalmem()` / `os.freemem()` |
| Drives | `Win32_LogicalDisk` → `MSFT_Partition` → `MSFT_Disk` → `MSFT_PhysicalDisk` |
| GPU | `Win32_VideoController` |
| Motherboard | `Win32_BaseBoard` + `Win32_BIOS` |
| Network | `Win32_NetworkAdapterConfiguration` + `Win32_NetworkAdapter` + perf counters |

---

## The drive join

This is what makes `"SSD (NVMe)"` real instead of a guess. It walks

```
DriveLetter → DiskNumber → MSFT_Disk.Number → MSFT_PhysicalDisk.DeviceId
```

so media type, bus type and health are read per disk. This is also the
foundation the Secure Erase SSD detection (design decision D-Q12b) builds on —
see `docs/PHASE-14-SECUREERASE.md`.

---

## Graceful degradation

Each section is fetched independently inside its own `try/catch`. One unavailable
CIM class degrades that field to `null` and logs a `console.warn` — it never
fails the whole call, and it never falls back to a made-up number. Non-Windows
throws a single clear error.

---

## What is `null` rather than invented

- `GPUInfo.usagePercent` / `tempC` — no vendor-agnostic counter exists; real GPU
  load needs NVML/AMD ADL/AGS.
- `GPUInfo.vramMb` — `AdapterRAM` is a 32-bit field, so >4 GB VRAM saturates it.
  When it reads ≤ 0, this is `null`.
- `CPUInfo.tempC` — ACPI thermal zones are OEM-dependent and usually need admin;
  `null` when unavailable.
- `NetworkInfo.linkSpeedMbps`, `MotherboardInfo.biosDate`, `CPUInfo.speedGhz`.

---

## UI

Optional values became nullable in `src/shared/types.ts`, and `SystemInfo.tsx`
renders them as `Unavailable` / an em dash — not `null`, `NaN` or a misleading `0`.
`healthStatus` gained `'bad'` for `HealthStatus` 2.

**Unchanged:** the preload IPC contract. Other modules are still mocked.

---

## Verified on Windows

Confirmed on the target machine:

**Three physical disks** — the drive join resolved all of them:

| Disk | MediaType | BusType | Health |
|---|---|---|---|
| SPCC M.2 SSD | 4 (SSD) | 11 | 0 (healthy) |
| ST1000LM035 HDD | 3 (HDD) | — | 0 (healthy) |
| KIOXIA EXCERIA SSD | 4 (SSD) | 17 | 0 (healthy) |

**GPU** — AMD Radeon RX 9060 XT, `AdapterRAM = 4293918720`. That is the 32-bit
saturation artifact (4095 MB), which is why `vramMb` is reported as `null` rather
than a wrong number.

**RAM** — Kingston 16 GB DDR5-6000, `SMBIOSMemoryType = 34`. The raw-code mapping
Phase 0 fixed is what makes this read `DDR5` instead of `Unknown`.

**CPU temperature** — `MSAcpi_ThermalZoneTemperature` returns `Access denied`
(HRESULT `0x80041003`) when unelevated. That is expected; the field degrades to
`null` and the UI shows `Unavailable`. It is the one Phase 0 query that needs
elevation, and the reason the startup elevation prompt exists.

**Event 101** — Diagnostics-Performance event 101 fires and returns real
degradation times, which Phase 2's boot-impact column consumes.

---

## Residuals — still live, both one-liners

Neither has been fixed; both are queued for the next agy run.

1. **`fileSystem: ld.FileSystem || 'NTFS'`** (`src/main/ipc.ts:421`) — an
   invented default when the field is missing. Should be `null`, like the other
   unreadable values.
2. **`healthStatus` defaults to `'good'`** (`src/main/ipc.ts:388`) — mildly
   optimistic rather than neutral when health data is unavailable.

Both violate the standing rule that a value that cannot be read is `null`, never
invented. They are the only known honesty defects in an otherwise real module.
