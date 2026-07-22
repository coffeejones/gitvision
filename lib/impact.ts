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
import { isTestFile } from "./codeAnalysis/testCoverage";
import { cmpStr } from "./deterministicSort";

/** True when a repo-relative path looks like a test file.
 *
 *  Delegates to the canonical `isTestFile` (lib/codeAnalysis/testCoverage.ts)
 *  so the untested signal here can never diverge from the rest of the app.
 *  That module is pure and imports only types, so it stays client-safe —
 *  blastRanking.ts already consumes it the same way. A local regex set used
 *  to live here and silently drifted (it missed .NET `*Test.cs`, `*_test.py`,
 *  minitest `_test.rb`, `.test.mjs/.cjs`, `/specs/`, …), producing false
 *  "untested" badges; re-exporting the one source of truth kills that class
 *  of bug. */
export const isTestPath = isTestFile;

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

/** Distinct direct-dependent count per file (test files excluded) — the raw
 *  fan-in map behind rankFilesByFanIn. Exposed so risk drift can diff it across
 *  snapshots ("auth.ts blast grew 12 → 31"). O(edges). */
export function fileFanIn(cg: CodeGraph): Map<string, number> {
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

  const out = new Map<string, number>();
  for (const [file, deps] of fanIn) {
    if (!isTestPath(file)) out.set(file, deps.size);
  }
  return out;
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
  return [...fileFanIn(cg).entries()]
    .map(([file, dependents]) => ({ file, dependents }))
    .sort((a, b) => b.dependents - a.dependents || cmpStr(a.file, b.file))
    .slice(0, Math.max(0, topN));
}

export interface FunctionImpactRank {
  /** Function name as captured by the parser. */
  name: string;
  /** Container (class/struct) when known — distinguishes overloads. */
  containerType?: string;
  /** Distinct calling functions (across all files) — direct fan-in. */
  callers: number;
}

/** Rank the functions defined in `file` by direct caller count, descending —
 *  seeds the "drill into a function" chips for the selected file. Functions
 *  never called still appear (callers: 0) so module entry points aren't
 *  hidden; ties break alphabetically for a stable UI. */
export function rankFunctionsInFile(
  cg: CodeGraph,
  file: string,
  topN = 12
): FunctionImpactRank[] {
  // Distinct caller ids per (name, container) key within the target file.
  const callers = new Map<string, Set<string>>();
  for (const c of cg.calls) {
    if (c.toFile !== file || !c.toFunction || c.fromFunction === null) continue;
    // Self-recursion isn't a caller: the blast engine drops self-edges
    // (from === to), so counting a function's own recursive call here would
    // make the chip read "foo 1" while drilling in shows "no tracked callers".
    if (c.fromFile === file && c.fromFunction === c.toFunction) continue;
    const key = `${c.toFunction}\x1E${c.toContainerType ?? ""}`;
    let set = callers.get(key);
    if (!set) {
      set = new Set<string>();
      callers.set(key, set);
    }
    // Include the caller's container so two same-named methods in one file
    // count as distinct callers instead of collapsing (undefined → "" for old
    // snapshots / regex-fallback edges, i.e. unchanged there).
    set.add(`${c.fromFile}\x1E${c.fromFunction}\x1E${c.fromContainerType ?? ""}`);
  }

  const seen = new Set<string>();
  const ranked: FunctionImpactRank[] = [];
  for (const fn of cg.functions) {
    if (fn.filePath !== file) continue;
    const key = `${fn.name}\x1E${fn.containerType ?? ""}`;
    if (seen.has(key)) continue; // overload rows collapse to one chip
    seen.add(key);
    ranked.push({
      name: fn.name,
      containerType: fn.containerType,
      callers: callers.get(key)?.size ?? 0,
    });
  }
  ranked.sort(
    (a, b) => b.callers - a.callers || cmpStr(a.name, b.name)
  );
  return ranked.slice(0, Math.max(0, topN));
}

/** The impact overlay handed to the dependency canvas: the changed file plus
 *  every file the change reaches, with the minimum hop distance per file. */
export interface ImpactHighlight {
  target: string;
  /** file path → min hop (1 = direct dependent). Excludes the target. */
  impacted: Map<string, number>;
}

/** Collapse blast entries (file- or function-level) to a per-file min-hop map
 *  for the canvas overlay. Function entries in the target file itself are
 *  dropped — the target is highlighted separately. */
export function toFileHighlight(
  target: string,
  entries: { filePath: string; hop: number }[]
): ImpactHighlight {
  const impacted = new Map<string, number>();
  for (const e of entries) {
    if (e.filePath === target) continue;
    const prev = impacted.get(e.filePath);
    if (prev === undefined || e.hop < prev) impacted.set(e.filePath, e.hop);
  }
  return { target, impacted };
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
