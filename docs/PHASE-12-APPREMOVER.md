# Phase 12 — App Remover

**Status:** ✅ implemented and verified (64/64 tests pass)
**Depends on:** Phase 0 (system bridge) ✅ · Phase 3 (destructive framework) ✅

## Goal

Replace the hardcoded `installedApps` array and the unconditional-success
`APPS_UNINSTALL` handler in `src/main/ipc.ts` with a real enumeration of
installed applications and a real, verified uninstall path through the Phase 3
framework.

The current handler removes the app from an in-memory array and reports
success. It does not uninstall anything. A user clicks "uninstall" and the
app disappears from the list while remaining fully installed on the machine —
the same failure mode as the fake `HEALTH_FIX` that reports freeing space it
never freed, and the fake `WIPE_FREE_SPACE` that reports wiping 10 GB it never
touched.

## Why this phase is different

AppRemover is the module where a false success is most damaging. A cleaner
that reports "uninstalled" while the application is still on the machine is
not a cosmetic lie — it makes the user believe software is gone when it is
not, and the next scan will show it still there, eroding trust in every
module. The verification requirement is not optional: success is reported
only when re-enumeration confirms the product is actually gone.

Uninstalling is **irreversible**. The framework's reversibility declaration
must say so, and the UI must show it before confirmation.

---

## Resolved decisions

### D-AR-1 — Enumeration source ✅

**Enumerate installed applications from the registry Uninstall keys.**

The Uninstall keys are where Windows records every installed application that
has a registered uninstaller. They cover both system-wide (HKLM) and
per-user (HKCU) installs, and both 64-bit and 32-bit views:

```
HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall
HKLM\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall
HKCU\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall
```

Each subkey is one installed product. The key name is often the product
code for MSI installs, or a descriptive name for other installs.

Values read per entry:

| Value | Used for |
|---|---|
| `DisplayName` | the app name shown in the UI |
| `DisplayVersion` | version |
| `Publisher` | publisher |
| `InstallDate` | install date (YYYYMMDD format) |
| `EstimatedSize` | size in KB (converted to bytes) |
| `InstallLocation` | installation directory |
| `UninstallString` | the command to run for non-MSI uninstall |
| `QuietUninstallString` | the command for silent non-MSI uninstall (if present) |
| `PSComponentID` | the MSI product code, when present |
| `SystemComponent` | if set to 1, the entry is a system component — excluded |
| `ParentKeyName` | if set, the entry is an update/patch — excluded |
| `NoModify` / `NoRepair` | MSI flags — used to refine the MSI command |

Entries where `SystemComponent` is `1` or `ParentKeyName` is present are
excluded. Entries with no `DisplayName` are excluded — they are install
internals, not user-facing applications.

### D-AR-2 — MSI preferred ✅

**When a product code exists, uninstall via `msiexec.exe`. Otherwise, use the
registry `UninstallString`.**

MSI uninstall is the supported, cleanest path. The product code is read from
`PSComponentID` (or from the key name when the key name is a GUID in braces).
When a product code is available, the uninstall command is:

```
msiexec.exe /x {PRODUCT_CODE} /qn
```

`/x` uninstalls, `/qn` runs with no UI. The full command is built by the
module, not read from the registry — the registry `UninstallString` for MSI
installs varies in the flags it carries, and we need the silent flag.

When no product code exists, the `UninstallString` from the registry is used.
It may be a full command line or a path to an uninstaller executable. The
command is parsed into executable + arguments, and a silent flag is appended
when one can be determined (see D-AR-3).

### D-AR-3 — Silent flags ✅

**Silent-flag differences are handled per uninstaller type. Where the correct
silent flag cannot be determined, the uninstall runs interactively.**

This is the hard part of non-MSI uninstall. There is no standard silent flag
across all uninstallers. The known cases:

| Uninstaller type | Silent flag | Notes |
|---|---|---|
| MSI (`msiexec.exe`) | `/qn` | No UI at all. `/qb` shows a basic progress bar. |
| Inno Setup | `/SILENT` | The most common non-MSI uninstaller. `/VERYSILENT` suppresses even more. |
| NSIS | `/S` | Must be passed as the last argument. Some NSIS uninstallers do not support it. |
| InstallShield | `/s` | Varies by version; sometimes `/s /v"/qn"`. |
| Wise Installer | `/s` | Less common. |

Detection is by inspecting the uninstaller executable's filename, its version
info, or the `UninstallString` itself for known patterns. When detection
fails, the uninstall runs **interactively** — the user sees the uninstaller's
own UI and completes it manually. An interactive uninstall is not a failure;
it is the correct fallback when the silent flag is unknown.

> **UNVERIFIED:** The silent-flag table above is compiled from common knowledge
> about these installer frameworks. The exact flags were not verified on the
> target machine or against specific uninstaller versions. The implementer
> must verify each detection pattern against real uninstallers on the target
> machine and record what was confirmed.

### D-AR-4 — Success requires verification ✅

**Uninstall success is never reported without re-enumeration confirming the
product is gone.**

After the uninstaller process exits, the module re-enumerates the Uninstall
keys and checks whether the product is still present. The verification is
specific:

1. **Wait** for the uninstaller process to exit.
2. **Re-enumerate** the Uninstall keys.
3. **Check** whether the product code / key name that was uninstalled is still
   present.
4. **If gone:** report success.
5. **If still present:** report failure with the reason ("uninstaller exited
   but the product is still registered").
6. **If the uninstaller process itself failed** (non-zero exit code): report
   failure immediately, without claiming success.

This is the same verification discipline the Phase 3 framework requires:
a write or delete that silently did nothing must never report success. The
current `HEALTH_FIX` — which reports freeing 4.89 GB it never freed — is the
exact failure mode this rule exists to prevent.

### D-AR-5 — Interactive uninstallers ✅

**When a silent flag cannot be determined, the uninstall runs interactively
and the module waits for it to complete.**

An interactive uninstaller shows its own UI — a wizard, a confirmation dialog,
a progress bar. The module:

1. Launches the uninstaller with no silent flag.
2. Waits for the process to exit (with a generous timeout).
3. Reports that the uninstall ran interactively and the user may need to complete
   it in the uninstaller's own UI.
4. Verifies by re-enumeration after the process exits.

The UI warns before launching: "This application's uninstaller requires
interaction. A window will appear — complete the uninstall there."

### D-AR-6 — Reboot-required uninstallers ✅

**Uninstallers that require a reboot are detected and reported. The module
does not claim success until the product is actually gone.**

Some uninstallers exit before fully removing the product — they schedule
removal for the next reboot. The module:

1. Launches the uninstaller.
2. Waits for exit.
3. Re-enumerates.
4. If the product is still present, checks whether the uninstaller created a
   pending-file-rename entry (`HKLM\SYSTEM\CurrentControlSet\Control\Session
   Manager\PendingFileRenameOperations`) — this is the standard Windows
   mechanism for reboot-deferred deletion.
5. If a pending rename is found, report: "Uninstall will complete after a
   reboot." Do not report success.
6. If no pending rename is found and the product is still present, report
   failure.

> **UNVERIFIED:** The `PendingFileRenameOperations` value format and its
> reliability as a reboot indicator were not confirmed on the target machine.
> The implementer must verify this detection works and degrade gracefully —
> if the value cannot be read, report "uninstall may require a reboot" rather
> than asserting the product is gone.

### D-AR-7 — Missing UninstallString ✅

**Entries whose `UninstallString` points at a missing file are flagged, not
run.**

Before launching any uninstaller, the module resolves the executable path
from the `UninstallString` and checks that the file exists. If it does not:

1. The entry is flagged in the UI as "uninstall unavailable — installer not
   found."
2. The entry is not offered for one-click uninstall.
3. The user is offered a "remove registry entry only" option, which goes
   through the framework as a `registry-key` action with its own confirmation.
   **The UI must state plainly that the application remains installed** — this
   removes it from the list, not from the machine. Presenting it as an uninstall
   would be the same false-success shape as the fake `HEALTH_FIX`.

A missing `UninstallString` with a valid MSI product code is still uninstallable
via `msiexec.exe` — the MSI path does not depend on the `UninstallString`.

### D-AR-8 — Windows Store / MSIX apps ✅

**Windows Store (UWP / MSIX) apps are enumerated separately and uninstalled
via PowerShell `Remove-AppxPackage`.**

MSIX and Store apps do not appear in the registry Uninstall keys in the same
way as desktop apps. They are enumerated via PowerShell:

```powershell
Get-AppxPackage | Select Name, PackageFullName, PackageFamilyName
```

Uninstall uses:

```powershell
Remove-AppxPackage -Package <PackageFullName>
```

Rails:
- Store apps are shown in a separate section, clearly labelled.
- `Remove-AppxPackage` requires elevation. The module refuses when unelevated.
- Verification is by re-running `Get-AppxPackage` and confirming the package
  is gone.
- Provisioned packages (installed for all users) are distinguished from
  per-user packages. Removing a provisioned package requires elevation and
  affects all users — the UI states this.
- Some system apps cannot be removed. The module refuses with a message rather
  than attempting and failing.

> **UNVERIFIED:** The exact PowerShell output shape of `Get-AppxPackage` and
> the behaviour of `Remove-AppxPackage` on the target machine were not
> confirmed. The implementer must verify the enumeration and uninstall work
> and that elevation is detected correctly.

### D-AR-9 — Irreversibility ✅

**Uninstalling an application is irreversible. The framework's reversibility
declaration says so.**

An uninstalled application can be reinstalled, but the module does not offer
to reinstall it — the user must obtain the installer themselves. The framework
plan for an uninstall declares:

- `reversibility: 'irreversible'`
- `irreversibilityReason: "Uninstalling removes the application. It can be reinstalled only by obtaining a new installer — DeskKlean does not offer a restore."`

The UI shows this reason before confirmation. An irreversible plan requires an
explicit acknowledgement — not a differently-coloured button, but a distinct
confirmation (see Phase 3 framework, Confirm step).

---

## Enumeration

### Registry Uninstall keys

Read via the existing PowerShell/CIM bridge (`src/main/system/powershell.ts`).

```powershell
$keys = @(
  'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall',
  'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall',
  'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall'
)
foreach ($key in $keys) {
  Get-ChildItem $key | ForEach-Object {
    $_.GetValue('DisplayName')
    $_.GetValue('DisplayVersion')
    # ... all values from the table above
  }
}
```

### Result type

```ts
interface InstalledApp {
  id: string;                    // key name (product code or GUID) — stable
  name: string;                  // DisplayName
  publisher: string;             // Publisher
  version: string;               // DisplayVersion
  installDate: string;           // InstallDate, normalised
  sizeBytes: number;             // EstimatedSize (KB) × 1024, or null if absent
  installLocation: string;       // InstallLocation
  uninstallString: string;       // UninstallString, or null
  quietUninstallString: string;  // QuietUninstallString, or null
  productCode: string;           // PSComponentID or GUID key name, or null
  isMsi: boolean;                // true when productCode is present
  isStoreApp: boolean;           // true for MSIX/UWP apps
  uninstallMethod: 'msi' | 'uninstall-string' | 'store' | 'unavailable';
  iconUrl?: string;
  leftoversDetected: number;     // always 0 in Phase 12 — not implemented
  isSystemComponent?: boolean;   // always false — system components excluded
}
```

`leftoversDetected` and `isSystemComponent` are retained from the existing
type for renderer compatibility. `leftoversDetected` is always `0` — leftover
detection is not in scope for Phase 12. `isSystemComponent` is always `false`
because system components are excluded at enumeration.

`uninstallMethod` is computed by the module and drives the uninstall path:

| Value | Condition |
|---|---|
| `msi` | `productCode` is present |
| `uninstall-string` | no product code, `UninstallString` exists and its target file exists |
| `unavailable` | no product code, `UninstallString` missing or its target file is missing |
| `store` | MSIX / UWP app |

---

## Uninstall flow

### Step 1 — resolve the uninstall command

For `uninstallMethod: 'msi'`:

```
msiexec.exe /x {PRODUCT_CODE} /qn
```

For `uninstallMethod: 'uninstall-string'`:

1. Parse the `UninstallString` into executable + arguments.
2. Resolve the executable path. Check the file exists.
3. Determine the uninstaller type and silent flag (D-AR-3).
4. If a silent flag is known: build the silent command.
5. If no silent flag is known: use the command as-is (interactive).

For `uninstallMethod: 'store'`:

```powershell
Remove-AppxPackage -Package <PackageFullName>
```

For `uninstallMethod: 'unavailable'`: refuse with a message.

### Step 2 — framework plan

The uninstall is expressed as a framework `uninstall` action:

```ts
{
  kind: 'uninstall',
  target: '<product code or package full name>',
  description: '<app name> (<version>)',
  reclaimableBytes: sizeBytes,   // the registry's EstimatedSize — an estimate, labelled as such
}
```

The plan declares `reversibility: 'irreversible'` with the D-AR-9 reason.
`requiresElevation: true` — uninstalling always requires administrator rights.

> **The framework has no `uninstall` action kind.** The current kinds are
> `delete-file`, `delete-tree`, `delete-key`, `delete-value` and
> `restore-registry`. Adding `uninstall` (or a `run-command` kind carrying an
> executable, arguments and a wait strategy) is part of this phase, not a
> discovery for the implementer.

> **`reclaimableBytes` is an estimate and must be labelled as one.** It comes
> from the registry's `EstimatedSize`, which is the installer's own estimate of
> its footprint. The previous comment called it "never estimated", which is the
> exact honesty failure this project exists to eliminate. The UI must say
> "estimated size" — or the module should compute the real size from
> `InstallLocation` using the Phase 9 walk. Never present an estimate as a
> measurement.

### Step 3 — execute

The framework:
1. Checks elevation. Refuses if unelevated.
2. Writes the backup manifest (the app's registry entry, captured before
   uninstall, so it is enumerable and reportable).
3. Launches the uninstaller process.
4. Waits for it to exit.
5. Re-enumerates to verify (D-AR-4).

### Step 4 — verify

The module re-enumerates the Uninstall keys (or `Get-AppxPackage` for Store
apps) and checks whether the product is gone.

- **Gone:** report success. Log the confirmed outcome.
- **Still present:** report failure with the reason. Do not claim success.
- **Reboot pending** (D-AR-6): report "will complete after reboot." Do not
  claim success.

---

## Contract changes

| Change | Detail |
|---|---|
| `InstalledApp` | real fields from registry; `uninstallMethod` added; `leftoversDetected` always 0; `isSystemComponent` always false |
| `getInstalledApps()` | real registry enumeration, not the hardcoded array |
| `uninstallApp(appId)` | rewritten to call `FRAMEWORK_PLAN` + `FRAMEWORK_EXECUTE`; returns verified result |
| `AppUninstallResult` | gains `verified: boolean` and `verificationDetail: string` |
| `APPS_UNINSTALL` | returns the framework `ExecuteResult`, not a fabricated success |

---

## Files

```
src/main/system/appRemover.ts     NEW  — registry enumeration, uninstall command
                                       construction, silent-flag detection,
                                       verification by re-enumeration
src/main/ipc.ts                  EDIT — replace APPS_GET_INSTALLED mock;
                                       rewire APPS_UNINSTALL to framework
src/shared/types.ts              EDIT — InstalledApp fields; AppUninstallResult
                                       gains verified + verificationDetail
src/renderer/.../AppRemover.tsx  EDIT — real app list, uninstall method badges,
                                       reboot warning, verification status
scripts/test-appremover.mjs       NEW — pure-logic tests (uninstall command
                                       parsing, silent-flag detection,
                                       enumeration filtering)
```

---

## Step specification

Status: 🔜 specified, not built

### Step 1 — registry enumeration

`src/main/system/appRemover.ts`. Read the three Uninstall keys via the
PowerShell bridge. Build `InstalledApp[]` from the values.

Rails:
- All three keys are read: HKLM, HKLM\WOW6432Node, HKCU. Missing one is not
  an error — some keys may be absent or unreadable.
- Entries with `SystemComponent = 1` or `ParentKeyName` present are excluded.
- Entries with no `DisplayName` are excluded.
- `EstimatedSize` is in KB in the registry; convert to bytes. Absent = `null`.
- `PSComponentID` is the MSI product code. The key name is a GUID in braces
  `{...}` for MSI installs when `PSComponentID` is absent.
- `uninstallMethod` is computed per the table above.
- The enumeration is read-only.

Acceptance (Windows): the list matches "Apps & Features" in Settings; MSI
apps show `isMsi: true`; system components are excluded; the WOW6432Node
entries appear.

### Step 2 — uninstall command construction

For MSI: build `msiexec.exe /x {productCode} /qn`.

For non-MSI: parse `UninstallString`, detect the uninstaller type, and build
the command with a silent flag when one is known.

Rails:
- The `UninstallString` may be a full quoted command line or a bare path.
  Handle both.
- The executable path is resolved and checked to exist before the command
  is used.
- Silent-flag detection is table-driven (D-AR-3). Unknown types fall back to
  interactive.
- The command construction is pure logic — unit-tested.

Acceptance (Linux, pure logic): `node scripts/test-appremover.mjs` — command
parsing, silent-flag detection, and enumeration filtering all pass.

### Step 3 — framework integration

`APPS_UNINSTALL` is rewritten to call `FRAMEWORK_PLAN` then
`FRAMEWORK_EXECUTE`. The plan is one `uninstall` action, irreversible.

Rails:
- The plan declares `reversibility: 'irreversible'` with the D-AR-9 reason.
- `requiresElevation: true`.
- The UI shows the irreversibility reason before confirmation.
- The UI shows the uninstall method (MSI / registry / Store) so the user
  knows what will happen.

Acceptance (Windows): planning an uninstall shows the app name, the
irreversibility warning, and the method; nothing is changed.

### Step 4 — execute and verify

The framework launches the uninstaller, waits for exit, and the module
re-enumerates to verify.

Rails:
- The uninstaller process is launched and waited on. A timeout is applied.
- **Wait for the process tree, not just the primary process.** Inno Setup and
  others spawn a child and exit immediately; a primary-only wait verifies
  before the uninstaller has finished, which reports a failure for an uninstall
  that is still in progress — or lets the next scan start underneath it.
- Verification is by re-enumeration (D-AR-4), not by the uninstaller's exit
  code alone.
- A reboot-pending detection runs when the product is still present after
  exit (D-AR-6).
- Missing `UninstallString` target files are caught before launch (D-AR-7).
- Partial failure is reported as partial.

Acceptance (Windows): uninstall a known MSI app → verify it is gone from the
Uninstall keys → report success. Uninstall a non-MSI app → verify. Attempt to
uninstall a system component → refuse. Attempt to uninstall with a missing
UninstallString target → refuse with a message.

### Step 5 — Store apps

MSIX / UWP apps are enumerated via `Get-AppxPackage` and uninstalled via
`Remove-AppxPackage`.

Rails:
- Store apps are in a separate section.
- Elevation is required. Refuse when unelevated.
- Verification is by re-running `Get-AppxPackage`.
- Provisioned packages are distinguished and the UI states the scope.

Acceptance (Windows): Store apps appear in the list; removing one verifies
it is gone; removing a provisioned package without elevation is refused.

---

## Implementation order

1. Registry enumeration (read-only) — step 1
2. Uninstall command construction + silent-flag detection — step 2
3. Framework integration (plan + irreversible declaration) — step 3
4. Execute + verification — step 4
5. Store apps — step 5

Steps 1–2 are read-only and can land on their own. Step 3 requires the Phase
3 framework. Step 4 is the first write and must not be attempted before step
3 works.

---

## Verification

Pure logic, runs on the build machine, required before the phase is done:

- `UninstallString` parsing: quoted command lines, bare paths, arguments with
  spaces
- Silent-flag detection: MSI, Inno Setup, NSIS, InstallShield, Wise, unknown
- Enumeration filtering: system components excluded, parent-key entries
  excluded, missing display names excluded, size conversion
- Uninstall-method classification: MSI vs non-MSI vs Store vs unavailable

Windows acceptance, run by the owner:

1. Enumerate installed apps → the list matches "Apps & Features"
2. Uninstall a known MSI app via `msiexec.exe` → verify it is gone
3. Uninstall a non-MSI app via `UninstallString` → verify it is gone
4. Attempt to uninstall a system component → confirm refusal
5. Attempt to uninstall an app whose `UninstallString` target is missing →
   confirm refusal with a message
6. Uninstall a Store app → verify it is gone
7. Attempt to uninstall unelevated → confirm refusal
8. Uninstall a reboot-requiring app → confirm the reboot message, not success
9. Verify that `APPS_UNINSTALL` does not report success when the product is
   still present after the uninstaller exits

---

## Risks

| Risk | Mitigation |
|---|---|
| Reporting success without verifying | Re-enumeration after uninstaller exit (D-AR-4) — this is the core requirement |
| Wrong silent flag causes a hung interactive uninstaller | Detect the uninstaller type; fall back to interactive with a UI warning; apply a timeout |
| Reboot-deferred removal reported as success | Check `PendingFileRenameOperations`; report "will complete after reboot" (D-AR-6) |
| Missing `UninstallString` target crashes the launcher | Check file existence before launch; flag as unavailable (D-AR-7) |
| MSI product code misread | Read from `PSComponentID` first; fall back to GUID key name; refuse if neither is a valid GUID |
| Store app removal without elevation | Detect elevation; refuse with a message |
| Registry enumeration misses the WOW6432Node view | Read all three keys explicitly |
| Uninstaller exits non-zero but the product is gone | Verification is by re-enumeration, not exit code — success is still reported |
| Uninstaller exits zero but the product is still present | Verification catches it; report failure (D-AR-4) |

---

## Open questions

| # | Question | Blocks |
|---|---|---|
| OQ-AR-1 | The silent-flag detection patterns for Inno Setup, NSIS, InstallShield, and Wise uninstallers were not verified against real uninstaller executables on the target machine. Which patterns are reliable? | Silent-flag detection (D-AR-3) |
| OQ-AR-2 | Is `PendingFileRenameOperations` a reliable indicator of reboot-deferred removal? Its format and behaviour were not confirmed on the target machine. | Reboot detection (D-AR-6) |
| OQ-AR-3 | Does `Get-AppxPackage` / `Remove-AppxPackage` work as expected on the target Windows version, and does elevation detection cover the Store-app path correctly? | Store apps (D-AR-8) |
| OQ-AR-4 | ~~Does the module need to wait for the entire process tree?~~ **Resolved (v1 decision): wait for the tree.** A primary-only wait verifies before a child-spawning uninstaller has finished, reporting a failure for an uninstall still in progress — or letting the next scan start underneath it. | Nothing — resolved |
