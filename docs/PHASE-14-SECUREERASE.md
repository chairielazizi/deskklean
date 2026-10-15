# Phase 14 — Secure Erase

**Status:** 🔜 specified, not built (half-real: `SHRED_ITEMS` overwrites real bytes, `WIPE_FREE_SPACE` is fiction)
**Depends on:** Phase 3 (destructive framework) 🔜 · Phase 0 (system bridge) ✅ · Phase 1 (drive join) ✅
**Decision:** D-R2-3 — option (b): files + free-space wipe, no full-drive erase in v1.

## Goal

Make SecureErase an honest module. Two paths, both real:

1. **File shredding** — overwrite a file's bytes with random data, then delete
   it. The current `SHRED_ITEMS` is half-real: it genuinely overwrites bytes
   but caps at 3 passes and does not declare irreversibility correctly.
2. **Free-space wiping** — overwrite the free space on a volume so deleted
   file remnants are harder to recover. The current `WIPE_FREE_SPACE`
   reports wiping 10 GB it never touched — this is fiction and must be
   replaced with real work or an honest refusal.

Both paths plug into the Phase 3 destructive framework: plan → confirm →
execute → verify → record.

## Honesty requirement (SSD)

**On an SSD, overwrite passes reduce recoverability but do NOT guarantee it.**

This is a physical limitation, not a software one. SSDs use **wear
levelling**: the flash translation layer maps logical block addresses to
physical NAND pages, and the mapping is opaque to the operating system.
When the OS writes to a logical block, the SSD may write to a different
physical page and mark the old page as stale. The old data remains on the
NAND until garbage collection erases it — and that erasure is internal to
the SSD's controller.

This means:

- Overwriting a file's logical blocks **does not prove** the physical pages
  that held the original data were overwritten.
- The original data may still exist on the NAND in a stale page.
- The **only** way to guarantee erasure on an SSD is the drive's own
  **ATA Secure Erase** command, which instructs the controller to erase
  all NAND pages including stale ones.

**The UI must say this.** A user who shreds a file on an SSD must see:

> Overwriting reduces the chance of recovery but does not guarantee it on an SSD.
> For a guaranteed erase, use your drive's ATA Secure Erase feature.

This is not a disclaimer to hide in an expandable section. It is a core
part of the module's output, shown before the user confirms a shred.

On a spinning disk (HDD), overwrite passes are more meaningful because
the head writes to the same physical location each time. Even on an HDD,
a single pass with random data is generally sufficient for modern high-density
drives — multi-pass methods (Gutmann 35-pass, DoD 5220.22-M 3-pass) were
designed for older, lower-density drives and provide negligible additional
security on modern hardware, at significant time cost.

---

## Resolved decisions

### D1 — Scope: files + free-space, no full-drive erase ✅

Per D-R2-3, option (b):

- **File shredding** — overwrite individual files, then delete.
- **Free-space wipe** — overwrite the free space on a volume.
- **Full-drive erase** — out of scope for v1. ATA Secure Erase operates on
  the entire drive and is not something DeskKlean invokes; the UI directs
  the user to their drive manufacturer's tool or the firmware's own
  secure erase command.

### D2 — Pass count ✅

**The pass count is configurable but defaults to 1.**

The current implementation caps at 3 passes. The spec asks whether
multi-pass methods are worth offering at all.

**Rationale for defaulting to 1:**

- On modern HDDs, a single pass with random data is sufficient. NIST
  SP 800-88 Rev. 1 states that a single overwrite pass is adequate for
  modern drives.
- On SSDs, as stated above, passes do not guarantee erasure regardless
  of count.
- Multi-pass shredding of a large file takes proportionally longer. A
  3-pass shred of a 10 GB file writes 30 GB. The marginal security
  benefit is negligible; the time cost is real.

**The pass count is still configurable** (1–3) because some users and
compliance regimes require a specific count. But the UI must state that
more passes do not increase the guarantee on an SSD, and that on modern
HDDs one pass is sufficient.

### D3 — Open files ✅

A file that is open by another process **cannot be shredded reliably** on
Windows. The overwrite may succeed (the file is opened for writing), but
the other process may re-write its data after DeskKlean's overwrite, or
the file may be memory-mapped.

**Behaviour:** The shred plan checks whether each target file is open. A
file that is open is reported in the plan's `blocked` list with the reason
"file is in use." The user sees this and can close the file and retry.
The framework's partial-failure reporting handles the case where some
files are open and others are not.

### D4 — Free-space wiping on a nearly-full volume ✅

Free-space wiping works by writing a temporary file that fills the
available free space, overwriting it with random data, then deleting it.
On a nearly-full volume, there may be little or no free space to wipe.

**Behaviour:** The plan checks the volume's free space. If free space is
below a threshold (e.g. 1% of volume size or 100 MB, whichever is
greater), the plan reports that there is insufficient free space to
wipe and the action is skipped with a reason. The user is not shown a
"success" for work that could not be done.

### D5 — Irreversibility ✅

**Shredding is irreversible by definition.** The Phase 3 framework's
reversibility declaration must say `reversible: 'irreversible'` with an
`irreversibilityReason`. The reason:

> Overwriting destroys the original bytes. The file cannot be restored
> from a backup because no backup is made — the backup would contain the
> very data the shred is meant to destroy.

The UI requires a **distinct confirmation** for irreversible operations,
not a differently-coloured button. The confirmation must state that the
operation cannot be undone.

**Free-space wiping is also irreversible.** It overwrites data that may
include remnants of deleted files the user might have wanted to recover.
Same reversibility declaration, same distinct confirmation.

---

## Contract changes

| Change | Detail |
|---|---|
| `SHRED_ITEMS` | rewritten to use the framework; real overwrite + delete; declares irreversible |
| `WIPE_FREE_SPACE` | rewritten to use the framework; real free-space overwrite; declares irreversible |
| `ShredOptions` | `{ passes: number (1–3, default 1), targetPaths: string[] }` |
| `WipeOptions` | `{ volumeRoot: string }` |
| `ShredResult` | framework `ExecuteResult` — partial failure reported as partial |
| `WipeResult` | framework `ExecuteResult` — reports actual bytes wiped, or refusal |

The framework contract from Phase 3 applies: `overwrite-file` action
kind, plan with `reversible: 'irreversible'`, distinct confirmation,
verify by read-back (confirm the file is gone / the free-space file was
deleted), record in the activity log.

---

## Files

```
src/main/system/secureErase.ts  NEW  — shredding, free-space wiping,
                                      pass-count logic, open-file check,
                                      free-space check
src/main/system/framework/     (Phase 3) — overwrite-file action kind
src/main/ipc.ts                EDIT — rewire SHRED_ITEMS, WIPE_FREE_SPACE
src/shared/types.ts           EDIT — ShredOptions, WipeOptions, ShredResult,
                                      WipeResult
src/renderer/.../SecureErase.tsx  EDIT — SSD honesty notice, pass count UI,
                                      irreversible confirmation, real results
scripts/test-secure-erase.mjs  NEW — pure-logic tests (pass count, open-file
                                      detection, free-space threshold)
```

---

## Implementation order

1. **Shredding** — overwrite file bytes with random data, then delete. Framework plan/execute. Irreversible declaration. Open-file check.
2. **Free-space wiping** — write temp file filling free space, overwrite with random data, delete. Framework plan/execute. Free-space threshold check.
3. **SSD honesty** — detect SSD vs HDD via the Phase 1 drive join (`MSFT_PhysicalDisk.MediaType`); display the honesty notice in the UI.
4. **Pass count** — configurable 1–3, default 1, with UI explanation of the SSD limitation.

Steps 1–2 are destructive and must not land before the Phase 3 framework
is complete.

---

## Verification

Pure logic, runs on the build machine, required before the phase is done:

- Pass count validation: 0 rejected, 1–3 accepted, >3 rejected
- Open-file detection: returns true for a file with a held handle
- Free-space threshold: returns "insufficient" below threshold, "sufficient" above
- Irreversibility declaration: shred plan has `reversible: 'irreversible'` with a reason
- Partial failure: 3 files, 1 open → `completed: 2, failed: 1, success: false`

Windows acceptance, run by the owner:

1. Shred a small test file on an HDD — confirm the file is gone after shredding
2. Shred a small test file on an SSD — confirm the file is gone, confirm the SSD honesty notice appeared
3. Attempt to shred an open file — confirm it is blocked with reason
4. Wipe free space on a volume with known free space — confirm the temp file is created, overwritten and deleted
5. Wipe free space on a nearly-full volume — confirm it refuses with "insufficient free space"
6. Confirm the activity log records real outcomes, not fabricated ones

---

## Risks

| Risk | Mitigation |
|---|---|
| `WIPE_FREE_SPACE` reports success for work not performed | This is the current fiction. The rewritten handler must report actual bytes wiped or refuse. Never report a number that was not measured. |
| Shredding an SSD gives a false sense of security | The UI honesty notice is mandatory. The reversibility declaration must state that overwrite does not guarantee erasure on SSD. |
| Multi-pass shredding takes disproportionate time | Default to 1 pass. Allow up to 3 but warn about time cost. |
| Open file causes partial shred failure | Check before planning. Report blocked files in the plan. Partial failure is reported as partial. |
| Free-space wipe on nearly-full volume fails silently | Check free space before planning. Refuse with a reason if insufficient. |
| The temp file for free-space wiping crashes mid-write | The framework's partial-failure reporting handles this. The temp file is deleted in a `finally` block. |
| The framework's `overwrite-file` action kind does not exist yet | This phase depends on Phase 3. It cannot land before the framework is complete. |

## Open questions

| # | Question | Blocks |
|---|---|---|
| OQ-SE-1 | How to detect that a file is open by another process — an exclusive lock attempt, handle enumeration, or an equivalent. The mechanism was not specified and must be chosen and tested on the target machine. | The "open file" refusal path |
| OQ-SE-2 | The temp file name and directory used for free-space wiping must be confirmed on the target machine. The spec only requires that it be created safely and deleted in a `finally` block. | Free-space wipe |
| OQ-SE-3 | SSD-vs-HDD detection depends on the Phase 1 Storage Management provider being present. If it is unavailable, detection returns `null` and the SSD honesty notice is shown **by default** — never assumed. | The honesty notice |
