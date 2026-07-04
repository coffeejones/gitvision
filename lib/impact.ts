// Impact-analysis helpers — the data layer behind the interactive
// "what breaks if I change this?" tool.
//
// The blast-radius engine (lib/codeAnalysis/blastRadius.ts) already does the
// hard part: pure BFS over the CodeGraph's import + call edges, computing the
// incoming (what breaks) and outgoing (what could break it) set for any file.
// It's explicitly designed to recompute in the client on every selection.
//
// This module adds the two things the tool needs on top of that engine, both
// pure over the CodeGraph so they run client-side too:
//   1. deriveTestedFiles — which files a test file reaches (import or call),
//      so the UI can flag "N of the things that break here have no test".
//   2. rankFilesByFanIn — the "most depended-on files" shortlist, a cheap
//      entry point ("here are the scariest files to touch — click to explore").

import type { CodeGraph } from "./codeAnalysis/types";

// Test-file path patterns — kept local so this module stays client-safe (no
// import of the server-side analysis modules). Mirrors the set in
// lib/signals.ts / lib/codeAnalysis/testCoverage.ts.
const TEST_PATTERNS: RegExp[] = [
  /\.test\.[jt]sx?$/i,
  /\.spec\.[jt]sx?$/i,
  /_test\.go$/i,
  /_spec\.rb$/i,
  /(^|\/)test_[^/]*\.py$/i,
  /(^|\/)tests?\//i,
  /(^|\/)__tests__\//i,
  /(^|\/)spec\//i,
];

/** True when a repo-relative path looks like a test file. */
export function isTestPath(path: string): boolean {
  return TEST_PATTERNS.some((re) => re.test(path));
}

/** The set of non-test files that at least one TEST file imports or calls
 *  into — our lightweight "has test coverage" signal, derived from the same
 *  graph the blast engine walks. A file absent from this set is treated as
 *  untested, which is exactly the risk to surface: "this change breaks X, and
 *  X has no test guarding it." */
export function deriveTestedFiles(cg: CodeGraph): Set<string> {
  const tested = new Set<string>();
  for (const e of cg.imports) {
    if (e.to && isTestPath(e.from)) tested.add(e.to);
  }
  for (const c of cg.calls) {
    if (c.toFile && isTestPath(c.fromFile)) tested.add(c.toFile);
  }
  return tested;
}

export interface FileImpactRank {
  /** Repo-relative file path. */
  file: string;
  /** Number of DISTINCT files that directly import or call into this file —
   *  a cheap fan-in proxy for "changing this ripples widely". */
  dependents: number;
}

/** Rank files by direct fan-in (distinct dependents), descending. Test files
 *  are excluded from the ranking — they're leaves you don't refactor to
 *  "maximize the codebase". A cheap O(edges) proxy for blast (the full
 *  per-file BFS is reserved for the selected file), used to seed the tool's
 *  "most-impactful files" shortlist. */
export function rankFilesByFanIn(
  cg: CodeGraph,
  topN = 12
): FileImpactRank[] {
  const fanIn = new Map<string, Set<string>>(); // target file → source files

  const add = (target: string | null | undefined, source: string) => {
    if (!target || !source || target === source) return;
    let deps = fanIn.get(target);
    if (!deps) {
      deps = new Set<string>();
      fanIn.set(target, deps);
    }
    deps.add(source);
  };

  for (const e of cg.imports) add(e.to, e.from);
  for (const c of cg.calls) add(c.toFile, c.fromFile);

  return [...fanIn.entries()]
    .filter(([file]) => !isTestPath(file))
    .map(([file, deps]) => ({ file, dependents: deps.size }))
    .sort((a, b) => b.dependents - a.dependents || a.file.localeCompare(b.file))
    .slice(0, Math.max(0, topN));
}

/** Distinct non-test files present in the graph (as an edge endpoint), sorted
 *  — the population the file selector picks from. */
export function impactFileList(cg: CodeGraph): string[] {
  const files = new Set<string>();
  for (const e of cg.imports) {
    if (e.from) files.add(e.from);
    if (e.to) files.add(e.to);
  }
  for (const c of cg.calls) {
    if (c.fromFile) files.add(c.fromFile);
    if (c.toFile) files.add(c.toFile);
  }
  return [...files].filter((f) => !isTestPath(f)).sort();
}
