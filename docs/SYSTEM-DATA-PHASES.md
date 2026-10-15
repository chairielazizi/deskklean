# System Data Phases

**Status:** Phase 0 ✅ · Phase 1 ✅ · Phase 2+ 🔜 (roadmap below)

**Goal:** replace the mocked values in `src/main/ipc.ts` with data read from the
machine, module by module. Until Phase 0 landed, every module returned hardcoded
constants or `Math.random()`.

---

## Phase 0 — System query bridge

**Files (new, additive — nothing existing was modified):** `src/main/system/`

```
src/main/system/
├── powershell.ts   spawn + JSON helpers over powershell.exe
├── cim.ts           Get-CimInstance wrapper + typed prebuilt queries
└── parse.ts         CIM/WMI value normalizers
```

### `powershell.ts`

| Export | Purpose |
|---|---|
| `isWindows()` | `process.platform === 'win32'` |
| `runPowerShell(script, opts?)` | Spawn `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command <script>` |
| `runPowerShellJson<T>(body, pipeline, opts?)` | Runs `body`, appends `pipeline \| ConvertTo-Json -Depth 6 -Compress`, parses |

Details that matter:

- **No `shell: true`** — the script is passed as a direct argument, so arguments
  cannot be shell-injected.
- The script is **prefixed** with `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8;`
  and `$ErrorActionPreference = 'Stop';`, so output is UTF-8 and errors surface.
- **15 s default timeout**; on timeout the child is killed and the rejection says so.
- **stderr is folded into the error** — a failing query never fails silently.
- `runPowerShellJson` normalizes PowerShell's **single-object-vs-array** JSON
  behaviour and treats empty output as an empty array instead of a parse error.
- On non-Windows, `runPowerShell` rejects with a clear Windows-only error.

### `cim.ts`

**The injection boundary.** `queryCim()` builds *static* `Get-CimInstance` calls:

- `className` and each `namespace` segment must match `/^[A-Za-z0-9_]+$/`.
- `filter` must match `/^[A-Za-z0-9 ='"_\-. *(),]+$/`.
  **The backtick is deliberately excluded** — it is PowerShell's escape character,
  and `buildCimCommand` escapes quotes via `` `" ``. A filter containing `` `" ``
  becomes `` `` `" ``, where PowerShell reads the doubled backtick as a literal
  backtick and then treats the following quote as *closing the string*, breaking
  out of the quoted argument. `|` and `%` are excluded too: a WQL filter never
  needs a pipeline or the `ForEach-Object` alias.
- A missing class or namespace returns `[]`, **not** an error.
- `stripCimMetadata()` drops `Cim*`/`PS*` keys so callers see only data.

**Typed prebuilt queries** (all accept `{ timeoutMs }`):

```
getProcessors()              Win32_Processor
getPhysicalMemory()          Win32_PhysicalMemory
getVideoControllers()        Win32_VideoController
getBaseBoard()               Win32_BaseBoard
getBios()                    Win32_BIOS
getOperatingSystem()         Win32_OperatingSystem
getLogicalDisks()            Win32_LogicalDisk (DriveType = 3)
getPhysicalDisks()           MSFT_PhysicalDisk  (root/Microsoft/Windows/Storage)
getPartitions()              MSFT_Partition
getDisks()                   MSFT_Disk
getNetworkAdapters()         Win32_NetworkAdapterConfiguration
getNetworkAdapterDevices()   Win32_NetworkAdapter
getNetworkPerformance()       Win32_PerfFormattedData_Tcpip_NetworkInterface
getCpuPerformance()          Win32_PerfFormattedData_PerfOS_Processor (Name='_Total')
getDiskPerformance()         Win32_PerfFormattedData_PerfDisk_LogicalDisk (Name='_Total')
getCpuTemperature()          MSAcpi_ThermalZoneTemperature  (root/wmi) — best effort
getActivationStatus()        SoftwareLicensingProduct
```

### `parse.ts`

| Export | Purpose |
|---|---|
| `toNumber(v)` | `string \| number \| null` → `number \| null` |
| `bytesToGb(v)` | bytes → GB (rounded) |
| `parseCimDate(v)` | `/Date(ms)/`, DMTF `yyyymmddHHMMSS.mmmmmms±UUU`, or ISO → ISO 8601 |
| `smbiosMemoryType(code)` | **raw** SMBIOS Type 17 → label |
| `mediaTypeLabel(code)` | MSFT_PhysicalDisk MediaType → `HDD` / `SSD` / `SCM` |
| `busTypeLabel(code)` | MSFT_PhysicalDisk BusType → `USB` / `RAID` / `SATA` / `NVMe` |

> **Read this before touching `smbiosMemoryType`.** `Win32_PhysicalMemory` has two
> similar properties: `MemoryType` is a *CIM-mapped* value, while
> `SMBIOSMemoryType` is the **raw** SMBIOS Type 17 `Memory_Type` value. The two use
> **different numberings**. The codes here are the raw ones —
> `18 DDR · 19 DDR2 · 20 DDR2 FB-DIMM · 24 DDR3 · 25 FBD2 · 26 DDR4 ·
> 27 LPDDR · 28 LPDDR2 · 29 LPDDR3 · 30 LPDDR4 · 31 Logical non-volatile device ·
> 32 HBM · 33 HBM2 · 34 DDR5 · 35 LPDDR5`.
>
> Verified against Microsoft's `Win32_PhysicalMemory` documentation and dmidecode's
> raw SMBIOS table. Getting these wrong is easy — the *other* property's values
> (20 DDR, 21 DDR2, 24 DDR3, 26 DDR4) are what you'd find on a first search.

---

## Phase 1 — System Info returns real data

`SYSTEM_GET_SPECS` previously invented its drive list (512 GB / 1 TB), GPU
(RTX 4070 Ti), motherboard (ROG STRIX Z790-E), CPU temperature, RAM speed/type and
OS build. `SYSTEM_GET_TELEMETRY` used `Math.random()` for cpu, diskRead and
diskWrite. Both now read from the machine.

| Section | Source |
|---|---|
| OS | `Win32_OperatingSystem` + `SoftwareLicensingProduct` |
| CPU | `Win32_Processor`, `Win32_PerfFormattedData_PerfOS_Processor`, `MSAcpi_ThermalZoneTemperature` |
| Memory | `Win32_PhysicalMemory` + `os.totalmem()` / `os.freemem()` |
| Drives | `Win32_LogicalDisk` → `MSFT_Partition` → `MSFT_Disk` → `MSFT_PhysicalDisk` |
| GPU | `Win32_VideoController` |
| Motherboard | `Win32_BaseBoard` + `Win32_BIOS` |
| Network | `Win32_NetworkAdapterConfiguration` + `Win32_NetworkAdapter` + perf counters |

**The drive join** is what makes `"SSD (NVMe)"` real instead of a guess. It walks
`DriveLetter → DiskNumber → MSFT_Disk.Number → MSFT_PhysicalDisk.DeviceId`, so
media type, bus type and health are read per disk. This is also the foundation
the Secure Erase SSD detection (design decision Q12b) will build on.

**Graceful degradation.** Each section is fetched independently inside its own
`try/catch`. One unavailable CIM class degrades that field to `null` and logs
`console.warn` — it never fails the whole call, and it never falls back to a made-up
number. Non-Windows throws a single clear error.

**What is `null` rather than invented:**

- `GPUInfo.usagePercent` / `tempC` — no vendor-agnostic counter exists; real GPU
  load needs NVML/AMD ADL/AGS.
- `GPUInfo.vramMb` — `AdapterRAM` is a 32-bit field, so >4 GB VRAM saturates it.
  When it reads ≤ 0, this is `null`.
- `CPUInfo.tempC` — ACPI thermal zones are OEM-dependent and usually need admin;
  `null` when unavailable.
- `NetworkInfo.linkSpeedMbps`, `MotherboardInfo.biosDate`, `CPUInfo.speedGhz`.

**UI:** optional values became nullable in `src/shared/types.ts` and
`SystemInfo.tsx` renders them as `Unavailable` / an em dash, not `null`, `NaN` or
a misleading `0`. `healthStatus` gained `'bad'` for `HealthStatus` 2.

**Unchanged:** the preload IPC contract. Other modules are still mocked.

---

## Verifying on Windows

The code has **never run** — PowerShell does not exist on the Linux dev machine, so
only types and logic are verified. To confirm on real hardware, run:

```powershell
Get-CimInstance Win32_LogicalDisk -Filter "DriveType = 3" | Select DeviceID, VolumeName, Size, FreeSpace, FileSystem
Get-CimInstance MSFT_PhysicalDisk -Namespace root/Microsoft/Windows/Storage | Select FriendlyName, MediaType, BusType, Size, HealthStatus
Get-CimInstance Win32_VideoController | Select Name, AdapterRAM, DriverVersion
Get-CimInstance Win32_PhysicalMemory | Select Manufacturer, Capacity, Speed, SMBIOSMemoryType
Get-CimInstance Win32_BaseBoard | Select Manufacturer, Product
Get-CimInstance Win32_BIOS | Select SMBIOSBIOSVersion, ReleaseDate
```

Then `npm run dev` and open the **System Info** tab. Expected:

- Real GPU name and driver version, VRAM in MB, `Unavailable` for load/temp
- Real RAM type (e.g. `DDR4`) and real speed
- Real drives labelled `SSD (NVMe)` / `HDD (SATA)` etc., not `512 GB` / `1 TB`
- Real motherboard manufacturer/model and a real BIOS date

**Note:** `Win32_PhysicalDisk` lives in `root/Microsoft/Windows/Storage`, which needs
the **Storage Management** provider. It is present on Windows 10/11 Pro and Server,
but can be missing on some Windows N editions or stripped images. If the drive
join comes back `Unknown`, that is the likely cause — and it degrades gracefully
rather than erroring.

---

## Residuals (known, both one-liners)

1. `fileSystem: ld.FileSystem || 'NTFS'` — an invented default when the field is
   missing. Should be `null` like the other unreadable values.
2. `healthStatus` defaults to `'good'` when health data is unavailable — mildly
   optimistic rather than neutral.

Neither has been fixed; both are queued for the next agy run.

---

## Roadmap

| Phase | Module | Notes |
|---|---|---|
| 0 ✅ | System bridge | `src/main/system/` |
| 1 ✅ | System Info | specs + telemetry real |
| 2 | **Startup Optimizer** | first module that *writes* to the system; introduces UAC elevation and real registry backup/restore |
| 3 | **SmartClean** | the core product; needs a rules engine and a dry-run mode before it can delete anything |
| 4 | **Registry Fixer** | highest risk; needs real `.reg` export/restore first — the fake backup was removed in `ad08a26` |
| 5 | App Remover | read uninstall strings, invoke them |
| 6 | Disk Analyzer | real directory walk + treemap |
| 7 | Duplicate Finder | content hashing |
| 8 | Extension Manager | read browser extension manifests |
| 9 | Secure Erase | needs SSD detection per Q12b — the Phase 1 drive join is its foundation |
| 10 | Health Check | aggregates 2–9, so it comes last |

**Standing rules for every phase:** `Math.random()` is banned; a value that
cannot be read is `null`, never invented; every section degrades independently;
and code changes go to agy (`gemini-3.8-flash-high`), never written directly.

---

## Working on this from Windows

```bash
npm install          # only if dependencies changed
npm run dev          # Electron dev build
npm run dist         # Windows installer (NSIS + portable)
```

- The app is **Windows-only**; the bridge throws a clear error on other platforms.
- `npm run dev` on Windows runs the real `src/main/ipc.ts`, so System Info shows
  live data immediately.
- Changes to `src/main/system/` are additive and do not affect the IPC contract,
  so Windows and Linux copies stay in sync without manual intervention.
