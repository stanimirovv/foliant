/**
 * Computes line-level diff between two versions of source code.
 * Returns 1-based line numbers in `newCode` that were added or modified.
 */

export interface LineDiffResult {
  changedLines: number[];       // 1-based line numbers in newCode
  firstChangedLine: number | null;
}

export function computeLineDiff(oldCode: string, newCode: string): LineDiffResult {
  if (oldCode === newCode) {
    return { changedLines: [], firstChangedLine: null };
  }

  const oldLines = oldCode.split('\n');
  const newLines = newCode.split('\n');

  // Strip common prefix
  let start = 0;
  while (
    start < oldLines.length &&
    start < newLines.length &&
    oldLines[start] === newLines[start]
  ) {
    start++;
  }

  // Strip common suffix
  let oldEnd = oldLines.length - 1;
  let newEnd = newLines.length - 1;
  while (
    oldEnd >= start &&
    newEnd >= start &&
    oldLines[oldEnd] === newLines[newEnd]
  ) {
    oldEnd--;
    newEnd--;
  }

  // The middle range in newLines: from `start` to `newEnd` (0-based)
  // If lines were only deleted in oldCode, newEnd < start.
  if (newEnd < start) {
    // Pure deletion. We can highlight the line at `start + 1` (clamped) as the deletion site,
    // or return the boundary line.
    const deletionAnchor = Math.min(start + 1, newLines.length);
    const changed = deletionAnchor > 0 ? [deletionAnchor] : [];
    return {
      changedLines: changed,
      firstChangedLine: changed[0] ?? null,
    };
  }

  const midOld = oldLines.slice(start, oldEnd + 1);
  const midNew = newLines.slice(start, newEnd + 1);

  // If the middle is small (<= 500 lines), run LCS on the middle segment
  // to avoid marking lines that remained unchanged during a reorder or insertion.
  const changedInMid = lcsDiff(midOld, midNew);

  const changedLines: number[] = [];
  for (const idx of changedInMid) {
    // Convert 0-based index in midNew to 1-based line number in newLines
    changedLines.push(start + idx + 1);
  }

  return {
    changedLines,
    firstChangedLine: changedLines[0] ?? null,
  };
}

/**
 * Returns 0-based indices in `newMid` that are not part of the LCS with `oldMid`.
 */
function lcsDiff(oldMid: string[], newMid: string[]): number[] {
  const m = oldMid.length;
  const n = newMid.length;

  if (m === 0) {
    // All lines in newMid are new
    return Array.from({ length: n }, (_, i) => i);
  }

  if (m * n > 250000) {
    // Fallback for massive middle segments: mark all middle lines
    return Array.from({ length: n }, (_, i) => i);
  }

  // Standard LCS DP
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldMid[i - 1] === newMid[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack to find which indices in newMid were matched
  const matchedInNew = new Set<number>();
  let i = m;
  let j = n;

  while (i > 0 && j > 0) {
    if (oldMid[i - 1] === newMid[j - 1]) {
      matchedInNew.add(j - 1);
      i--;
      j--;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      i--;
    } else {
      j--;
    }
  }

  const changed: number[] = [];
  for (let idx = 0; idx < n; idx++) {
    if (!matchedInNew.has(idx)) {
      changed.push(idx);
    }
  }

  return changed;
}
