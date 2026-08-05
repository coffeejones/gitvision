// Near-duplicate function detection (v0.30). Groups functions sharing
// the same structural body hash so users can see "this code exists in
// 5 places, consider extracting a helper".
//
// Pure function over CodeGraph — runs client-side fast enough that the
// UI can recompute on every snapshot change without a server round-trip.
//
// Quality knobs (defaulted aggressively to keep noise out):
//   - complexity floor: skip functions below MIN_COMPLEXITY (default 2)
//     so we don't surface "every getter is a duplicate" noise.
//   - file-spread floor: a group must span MIN_FILE_SPREAD distinct files
//     (default 3). Complexity alone was the wrong knob — measured below.
//   - group size floor: a "group" needs ≥2 members to be a duplicate.
//   - sort key: groupSize × maxComplexity, so the worst tech-debt
//     finds (many copies of complex code) rise to the top.
//   - hard cap: keep the panel scannable on screen — top N groups only.
//
// Hash semantics: see astHash.ts. Two functions hashing identically are
// AST-structurally identical modulo identifier names and literal values.
// They might still differ in identifier semantics (calling different
// methods) — but the structure is the same. Real-world refactor signal.

import type { CodeGraph, FunctionDef } from "./types";
import { cmpStr } from "../deterministicSort";

export interface DuplicateGroup {
  /** The shared body hash. Internal — not surfaced to users. */
  hash: string;
  /** All functions sharing this hash. At least 2 entries (single-fn
   *  groups are filtered out — they're not duplicates). */
  members: FunctionDef[];
  /** Highest complexity across the group. Used both for ranking and
   *  as the canonical complexity displayed in the UI ("the worst of
   *  these is X"). */
  maxComplexity: number;
}

export interface FindDuplicatesOptions {
  /** Skip functions below this McCabe complexity. Default 5. Lower
   *  values surface trivial accessors / one-liners that are
   *  duplicates by accident, not design. */
  minComplexity?: number;
  /** Cap the result list. Default 15 — enough for an actionable
   *  panel, short enough to scan. */
  limit?: number;
  /** Distinct files a group must span. Default 3. Set to 1 to disable. */
  minFileSpread?: number;
}

// Complexity alone cannot tell copy-paste from convention, and the two errors
// it makes point in opposite directions. Measured on three repos:
//
//   floor 5 (was)          this repo 6 groups | netbox 8   | flask 0
//   floor 1                          113      |      563   |     96
//   spread >= 3 alone                 38      |       81   |     28
//   floor 2 AND spread >= 2           47      |       43   |      0
//
// At floor 1 NetBox reports a single "group" of 288 identical `test_name()`
// methods — Django's own test convention, not tech debt, and extracting a
// helper for it would be wrong. At floor 5 the panel misses `fileBasename()`
// written eleven times in eleven different files, which is exactly the thing
// the surface exists to find.
//
// SPREAD is the discriminator the surface was missing: a one-liner repeated
// inside ONE file is that file's idiom; the same helper appearing once per
// file across eleven files is copy-paste. Spread alone is not enough either —
// it lets NetBox's 278-member same-file pile-up straight through — so both
// conditions are required.
//
// Two, not three. A helper copied into two files IS duplication, and the
// panel's sort (groupSize x maxComplexity) plus the limit already handle
// volume: the top 15 is IDENTICAL at spread 2 and 3 on both repos measured,
// so a higher floor only trims the tail — and on NetBox it was trimming real
// two-file clones. Tightening a floor to protect a count the cap already
// protects is how a surface starts hiding true findings.
const DEFAULT_MIN_COMPLEXITY = 2;
const DEFAULT_MIN_FILE_SPREAD = 2;
const DEFAULT_LIMIT = 15;

/** How many groups exist BEFORE the panel's cap.
 *
 *  The cap became binding once file spread replaced the complexity floor —
 *  this repo and NetBox both fill all 15 slots where they previously produced
 *  6 and 8. A list that silently stops at 15 tells the reader the repo has 15
 *  duplicate groups, which is false. Same lesson as the security rollup: a
 *  number the reader cannot reconcile costs more than the truncation saves. */
export function countDuplicateGroups(
  codeGraph: CodeGraph,
  opts: FindDuplicatesOptions = {}
): number {
  return findDuplicateGroups(codeGraph, { ...opts, limit: Number.MAX_SAFE_INTEGER }).length;
}

/** Group functions by structural bodyHash. Returns groups with ≥2
 *  members where every member meets the complexity floor. Sorted by
 *  groupSize × maxComplexity descending — biggest fish first. */
export function findDuplicateGroups(
  codeGraph: CodeGraph,
  opts: FindDuplicatesOptions = {}
): DuplicateGroup[] {
  const minComplexity = opts.minComplexity ?? DEFAULT_MIN_COMPLEXITY;
  const limit = opts.limit ?? DEFAULT_LIMIT;
  const minFileSpread = opts.minFileSpread ?? DEFAULT_MIN_FILE_SPREAD;

  // Bucket by hash. Functions without a bodyHash (legacy snapshots,
  // not-yet-instrumented plugins) are excluded — they can't be matched.
  const buckets = new Map<string, FunctionDef[]>();
  for (const fn of codeGraph.functions) {
    if (!fn.bodyHash) continue;
    if (fn.complexity < minComplexity) continue;
    const arr = buckets.get(fn.bodyHash) ?? [];
    arr.push(fn);
    buckets.set(fn.bodyHash, arr);
  }

  // Build groups. Single-member buckets aren't duplicates and get dropped.
  const groups: DuplicateGroup[] = [];
  for (const [hash, members] of buckets) {
    if (members.length < 2) continue;
    // Copy-paste crosses file boundaries; an idiom repeated inside one file
    // does not. See the note on DEFAULT_MIN_FILE_SPREAD.
    if (new Set(members.map((m) => m.filePath)).size < minFileSpread) continue;
    let maxComplexity = 0;
    for (const m of members) {
      if (m.complexity > maxComplexity) maxComplexity = m.complexity;
    }
    groups.push({ hash, members, maxComplexity });
  }

  // Sort: groupSize × maxComplexity descending. Ties broken by
  // maxComplexity, then by group size, then by first-member's filePath
  // for determinism.
  groups.sort((a, b) => {
    const aScore = a.members.length * a.maxComplexity;
    const bScore = b.members.length * b.maxComplexity;
    if (bScore !== aScore) return bScore - aScore;
    if (b.maxComplexity !== a.maxComplexity)
      return b.maxComplexity - a.maxComplexity;
    if (b.members.length !== a.members.length)
      return b.members.length - a.members.length;
    return cmpStr(a.members[0].filePath, b.members[0].filePath);
  });

  return groups.slice(0, limit);
}

/** Aggregate stats useful for the UI's panel header. Counts total
 *  duplicate functions across all groups, total groups, and the most-
 *  duplicated group's size. Computed from the same options as
 *  findDuplicateGroups so numbers in the header match the rendered list. */
export function summarizeDuplicates(groups: DuplicateGroup[]): {
  totalGroups: number;
  totalDuplicateFunctions: number;
  largestGroupSize: number;
} {
  let totalDuplicateFunctions = 0;
  let largestGroupSize = 0;
  for (const g of groups) {
    totalDuplicateFunctions += g.members.length;
    if (g.members.length > largestGroupSize) largestGroupSize = g.members.length;
  }
  return {
    totalGroups: groups.length,
    totalDuplicateFunctions,
    largestGroupSize,
  };
}
