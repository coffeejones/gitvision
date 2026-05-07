// Cross-snapshot structural diff (v0.67 / C2).
//
// Computes the per-function / per-file / per-duplicate-group changes
// between two AnalysisSnapshots. Powers the "structural changes since
// last visit" panel on the Overview AND the compare_sessions MCP tool
// for AI agents.
//
// Distinct from lib/diff.ts (which computes aggregate-level deltas
// like newCommits, starsDelta, hotspotRankChanges). This module
// answers the next-zoom-level question: "Which specific functions /
// files / dup-groups changed?".
//
// Pure function over two AnalysisSnapshots. No I/O, no AI. Defensive
// against missing codeGraph on either side — returns a partial result
// with a `degraded` flag instead of crashing.

import type { AnalysisSnapshot, CodeGraph } from "../types";
import type { FunctionDef } from "../codeAnalysis/types";
import { findDuplicateGroups } from "../codeAnalysis/duplicates";
import { computeTestCoverage } from "../codeAnalysis/testCoverage";

export interface StructuralFnRef {
  filePath: string;
  name: string;
  containerType?: string;
  complexity: number;
}

export interface ComplexityShift {
  filePath: string;
  fromComplexity: number;
  toComplexity: number;
  /** toComplexity - fromComplexity. Positive = file got more complex. */
  delta: number;
}

export interface CoverageDelta {
  fromPct: number;
  toPct: number;
  delta: number;
}

export interface StructuralDiff {
  /** ISO timestamps of the snapshots being compared. Useful for UI
   *  copy ("vs. 6 hours ago"). */
  fromFetchedAt: string;
  toFetchedAt: string;

  /** Top-10 functions present in `curr` but not in `prev`, sorted by
   *  complexity descending so the most-meaningful additions surface
   *  first. */
  functionsAdded: StructuralFnRef[];
  /** Top-10 functions present in `prev` but not in `curr`. */
  functionsRemoved: StructuralFnRef[];
  /** Total counts even when the displayed list is capped — UI can
   *  show "showing top 10 of 47". */
  totalAdded: number;
  totalRemoved: number;

  /** Net delta: positive = more dup-groups now, negative = some
   *  refactor eliminated dup-groups. Zero is the silent-good case. */
  duplicateGroupsAdded: number;
  duplicateGroupsDissolved: number;

  /** Coverage delta when BOTH snapshots had test files detected. null
   *  when either side lacks test infrastructure (the comparison would
   *  be misleading). */
  coverageDelta: CoverageDelta | null;

  /** Top complexity shifts per file, split into worsening (delta > 0)
   *  and improving (delta < 0) buckets. Each bucket is capped at 5
   *  files. Files with delta = 0 are excluded — they're not "shifts". */
  complexityWorsened: ComplexityShift[];
  complexityImproved: ComplexityShift[];

  /** Set when one or both snapshots lacked a codeGraph. The other
   *  fields are still computed where possible (e.g. timestamps,
   *  coverage if both sides have it). */
  degraded?: string;
}

const FN_LIST_CAP = 10;
const COMPLEXITY_SHIFT_CAP = 5;

export function structuralDiff(
  prev: AnalysisSnapshot,
  curr: AnalysisSnapshot
): StructuralDiff {
  // Always-available fields — even when codeGraph is missing on one side
  // we want the diff metadata to be usable.
  const baseEmpty: StructuralDiff = {
    fromFetchedAt: prev.fetchedAt,
    toFetchedAt: curr.fetchedAt,
    functionsAdded: [],
    functionsRemoved: [],
    totalAdded: 0,
    totalRemoved: 0,
    duplicateGroupsAdded: 0,
    duplicateGroupsDissolved: 0,
    coverageDelta: null,
    complexityWorsened: [],
    complexityImproved: [],
  };

  if (!prev.codeGraph || !curr.codeGraph) {
    return {
      ...baseEmpty,
      degraded:
        "Code graph missing on one or both snapshots — only timestamps available.",
    };
  }

  const fnDiff = diffFunctions(prev.codeGraph, curr.codeGraph);
  const dupDiff = diffDuplicateGroups(prev.codeGraph, curr.codeGraph);
  const coverageDelta = diffCoverage(prev.codeGraph, curr.codeGraph);
  const complexityShifts = diffFileComplexity(prev.codeGraph, curr.codeGraph);

  return {
    fromFetchedAt: prev.fetchedAt,
    toFetchedAt: curr.fetchedAt,
    functionsAdded: fnDiff.added.slice(0, FN_LIST_CAP),
    functionsRemoved: fnDiff.removed.slice(0, FN_LIST_CAP),
    totalAdded: fnDiff.added.length,
    totalRemoved: fnDiff.removed.length,
    duplicateGroupsAdded: dupDiff.added,
    duplicateGroupsDissolved: dupDiff.dissolved,
    coverageDelta,
    complexityWorsened: complexityShifts.worsened.slice(0, COMPLEXITY_SHIFT_CAP),
    complexityImproved: complexityShifts.improved.slice(0, COMPLEXITY_SHIFT_CAP),
  };
}

// ---------------- Function diff ----------------

/** Stable identity for a function across snapshots: file + name +
 *  container. Two functions with the same triple are "the same"
 *  even if line numbers shifted. We don't try to detect renames or
 *  cross-file moves — those would surface as one removal + one
 *  addition. Acceptable for v1; rename-tracking is a separate
 *  exercise. */
function fnKey(fn: FunctionDef): string {
  return `${fn.filePath}\x1F${fn.containerType ?? ""}\x1F${fn.name}`;
}

interface FunctionDiffResult {
  added: StructuralFnRef[];
  removed: StructuralFnRef[];
}

function diffFunctions(prev: CodeGraph, curr: CodeGraph): FunctionDiffResult {
  const prevKeys = new Set(prev.functions.map(fnKey));
  const currKeys = new Set(curr.functions.map(fnKey));

  const added = curr.functions
    .filter((fn) => !prevKeys.has(fnKey(fn)))
    .map(toFnRef);
  const removed = prev.functions
    .filter((fn) => !currKeys.has(fnKey(fn)))
    .map(toFnRef);

  // Sort by complexity desc so high-impact additions/removals lead
  // the displayed list. Tie-breaker: name ascending for stability.
  const byComplexity = (a: StructuralFnRef, b: StructuralFnRef): number => {
    if (b.complexity !== a.complexity) return b.complexity - a.complexity;
    return a.name.localeCompare(b.name);
  };
  added.sort(byComplexity);
  removed.sort(byComplexity);
  return { added, removed };
}

function toFnRef(fn: FunctionDef): StructuralFnRef {
  return {
    filePath: fn.filePath,
    name: fn.name,
    containerType: fn.containerType,
    complexity: fn.complexity,
  };
}

// ---------------- Duplicate-group diff ----------------

interface DuplicateDiffResult {
  added: number;
  dissolved: number;
}

/** Compare duplicate groups by their structural hash. A group is
 *  "added" if its hash is in curr but not prev — a new structural
 *  duplicate emerged. "Dissolved" the other way around. We only
 *  return counts; the per-group detail would bloat the API and most
 *  agents/UIs only need the magnitude. */
function diffDuplicateGroups(
  prev: CodeGraph,
  curr: CodeGraph
): DuplicateDiffResult {
  const prevHashes = new Set(findDuplicateGroups(prev).map((g) => g.hash));
  const currHashes = new Set(findDuplicateGroups(curr).map((g) => g.hash));
  let added = 0;
  let dissolved = 0;
  for (const h of currHashes) if (!prevHashes.has(h)) added++;
  for (const h of prevHashes) if (!currHashes.has(h)) dissolved++;
  return { added, dissolved };
}

// ---------------- Coverage diff ----------------

function diffCoverage(prev: CodeGraph, curr: CodeGraph): CoverageDelta | null {
  const prevCov = computeTestCoverage(prev);
  const currCov = computeTestCoverage(curr);
  // Both sides must have test infrastructure — comparing "no tests
  // detected" against a covered repo would just be noise.
  if (prevCov.totals.testFiles === 0 || currCov.totals.testFiles === 0) {
    return null;
  }
  const fromPct = pct(
    prevCov.totals.testedProdFunctions,
    prevCov.totals.prodFunctions
  );
  const toPct = pct(
    currCov.totals.testedProdFunctions,
    currCov.totals.prodFunctions
  );
  return { fromPct, toPct, delta: toPct - fromPct };
}

function pct(numerator: number, denominator: number): number {
  return denominator > 0 ? Math.round((numerator / denominator) * 100) : 0;
}

// ---------------- Complexity-shift diff ----------------

interface ComplexityShiftsResult {
  worsened: ComplexityShift[];
  improved: ComplexityShift[];
}

function diffFileComplexity(
  prev: CodeGraph,
  curr: CodeGraph
): ComplexityShiftsResult {
  const allFiles = new Set<string>([
    ...Object.keys(prev.fileComplexity),
    ...Object.keys(curr.fileComplexity),
  ]);
  const shifts: ComplexityShift[] = [];
  for (const filePath of allFiles) {
    const fromComplexity = prev.fileComplexity[filePath] ?? 0;
    const toComplexity = curr.fileComplexity[filePath] ?? 0;
    const delta = toComplexity - fromComplexity;
    if (delta === 0) continue;
    shifts.push({ filePath, fromComplexity, toComplexity, delta });
  }
  // Worsened = positive delta, sorted desc by delta size
  const worsened = shifts
    .filter((s) => s.delta > 0)
    .sort((a, b) => b.delta - a.delta);
  // Improved = negative delta, sorted asc (most negative first)
  const improved = shifts
    .filter((s) => s.delta < 0)
    .sort((a, b) => a.delta - b.delta);
  return { worsened, improved };
}

// ---------------- Convenience ----------------

/** Quick "is anything noteworthy?" check so callers can decide whether
 *  to render a panel at all. Returns true when at least one structural
 *  change exists.
 *
 *  v0.71: coverageDelta is non-null whenever both snapshots have tests,
 *  even when the percentage is identical. We must check delta !== 0,
 *  not the wrapper, otherwise a refresh against an unchanged repo
 *  rendered a panel with an empty SummaryStrip and no per-list content
 *  — looked broken on the Overview. */
export function structuralDiffHasContent(diff: StructuralDiff): boolean {
  return (
    diff.totalAdded > 0 ||
    diff.totalRemoved > 0 ||
    diff.duplicateGroupsAdded > 0 ||
    diff.duplicateGroupsDissolved > 0 ||
    (diff.coverageDelta !== null && diff.coverageDelta.delta !== 0) ||
    diff.complexityWorsened.length > 0 ||
    diff.complexityImproved.length > 0
  );
}
