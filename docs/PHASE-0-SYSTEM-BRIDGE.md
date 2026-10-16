# Phase 0 — System query bridge

**Status:** ✅ implemented · type-and-logic verified on Linux · Windows acceptance passed
**Plan position:** Phase 0 of 15 — see `docs/ROADMAP.md`
**Phase file:** this document
**Supersedes:** the Phase 0 section of `docs/SYSTEM-DATA-PHASES.md`

---

## Goal

Until this phase landed, every module in `src/main/ipc.ts` returned hardcoded
constants or `Math.random()`. Phase 0 builds the only bridge to the machine:
a typed, injection-safe PowerShell/CIM layer. It adds files and modifies
nothing existing.

## Files (new, additive)

```
src/main/system/
├── powershell.ts   spawn + JSON helpers over powershell.exe
├── cim.ts           Get-CimInstance wrapper + typed prebuilt queries
└── parse.ts         CIM/WMI value normalizers
```

---

## `powershell.ts`

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

---

## `cim.ts` — the injection boundary

`queryCim()` builds *static* `Get-CimInstance` calls:

- `className` and each `namespace` segment must match `/^[A-Za-z0-9_]+$/`.
- `filter` must match `/^[A-Za-z0-9 ='\"_\-. *(),]+$/`.
  **The backtick is deliberately excluded** — it is PowerShell's escape character,
  and `buildCimCommand` escapes quotes via `` `\" ``. A filter containing `` `\" ``
  becomes `` `` `\" ``, where PowerShell reads the doubled backtick as a literal
  backtick and then treats the following quote as *closing the string*, breaking
  out of the quoted argument. `|` and `%` are excluded too: a WQL filter never
  needs a pipeline or the `ForEach-Object` alias.
- A missing class or namespace returns `[]`, **not** an error.
- `stripCimMetadata()` drops `Cim*`/`PS*` keys so callers see only data.

> **Defect found in review and fixed:** an early revision of the filter regex
> still allowed the backtick, which is the escape character described above.
> That is a command-injection path. The character is now excluded.

### Typed prebuilt queries (all accept `{ timeoutMs }`)

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

---

## `parse.ts`

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

> **Defect found in review and fixed:** an early revision mapped the
> *CIM-mapped* `MemoryType` codes onto `SMBIOSMemoryType`, so DDR5 (raw 34)
> would have been reported as an unknown type. The mapping is now the raw one.

---

## Verification

### On Linux (what could be verified)

- The filter and class-name regexes, the SMBIOS table and the media/bus type
  tables are pure logic and are covered by unit tests.
- `tsc --noEmit` clean.
- No PowerShell, no WMI, no registry here — nothing was executed.

### On Windows (acceptance — passed)

- `Get-CimInstance` returned real values for every class above.
- The drive join resolved three physical disks (see Phase 1).
- `MSAcpi_ThermalZoneTemperature` returns `Access denied` (HRESULT
  `0x80041003`) when unelevated — this is expected and is handled as `null`
  (see Phase 1, graceful degradation). It is the one query that needs elevation.
- Event 101 (Diagnostics-Performance) fires and returns real degradation times,
  which Phase 2's boot-impact column consumes.

---

## What this phase does **not** do

- It writes nothing to the system. Every query is read-only.
- It does not touch the registry — that is Phase 2.
- It does not touch the filesystem — that is Phase 9 onward.

---

## Residuals

None open. The two defects found during review (the filter-regex backtick and
the SMBIOS mapping) are fixed and committed.
