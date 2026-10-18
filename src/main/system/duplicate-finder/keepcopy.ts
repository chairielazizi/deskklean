/**
 * D-DF-8 Keep-Copy Selection
 *
 * The keep-copy is chosen by this rule, applied in order:
 * 1. Shortest full path — the copy whose resolved absolute path has the
 *    fewest characters.
 * 2. Alphabetical order of the full path — tie-break when two paths are the
 *    same length. Lowercase comparison, full resolved path.
 * 3. Earliest creation time — tie-break when paths are identical in length
 *    and alphabetical order. Best-effort: NTFS birthtime can be 0 or stale.
 * 4. Deterministic first — if all above are equal, the first in the
 *    enumerated order is kept. Arbitrary but stable.
 *
 * Pure logic, no filesystem access.
 */

export interface KeepCopyCandidate {
  path: string;
  birthtimeMs?: number;
  [key: string]: any;
}

/**
 * Compares two candidates according to the D-DF-8 rule.
 * Returns negative if a wins, positive if b wins, 0 if completely tied.
 */
export function compareKeepCopyCandidates(
  a: KeepCopyCandidate,
  b: KeepCopyCandidate,
  aIndex: number = 0,
  bIndex: number = 0
): number {
  // 1. Shortest full path
  if (a.path.length !== b.path.length) {
    return a.path.length - b.path.length;
  }

  // 2. Alphabetical order of the full path (lowercase comparison)
  const aLower = a.path.toLowerCase();
  const bLower = b.path.toLowerCase();
  if (aLower < bLower) return -1;
  if (aLower > bLower) return 1;

  // 3. Earliest creation time (smaller timestamp wins)
  const aTime = typeof a.birthtimeMs === 'number' && !isNaN(a.birthtimeMs) ? a.birthtimeMs : 0;
  const bTime = typeof b.birthtimeMs === 'number' && !isNaN(b.birthtimeMs) ? b.birthtimeMs : 0;
  if (aTime !== bTime) {
    if (aTime > 0 && bTime > 0) {
      return aTime - bTime;
    }
    // If only one has a valid creation time > 0, prefer the known timestamp
    if (aTime > 0) return -1;
    if (bTime > 0) return 1;
  }

  // 4. Deterministic first in enumerated order
  return aIndex - bIndex;
}

/**
 * Selects the keep-copy candidate from a non-empty list of candidates.
 */
export function selectKeepCopy<T extends KeepCopyCandidate>(candidates: T[]): T {
  if (!candidates || candidates.length === 0) {
    throw new Error('Cannot select keep-copy from an empty candidate list');
  }
  if (candidates.length === 1) {
    return candidates[0];
  }

  let winner = candidates[0];
  let winnerIndex = 0;

  for (let i = 1; i < candidates.length; i++) {
    const cmp = compareKeepCopyCandidates(candidates[i], winner, i, winnerIndex);
    if (cmp < 0) {
      winner = candidates[i];
      winnerIndex = i;
    }
  }

  return winner;
}
