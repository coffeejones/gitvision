// Refactor-Safety Radar — the data layer behind the "Can I touch this?" surface
// (Arc 1). Pure over the CodeGraph and client-safe (imports only types + other
// pure helpers), so it can be computed server-side and shipped small, or
// recomputed in the client like the impact tool.
//
// It COMPOSES four already-computed signals into a per-file safety TIER —
// deliberately a named tier, never a bare 0-100 score. Every tier is backed by
// the raw evidence (dependents, untested dependents, complexity, duplicates),
// which the UI always shows: the number is the argument, the tier is only the
// headline. Thresholds are heuristic and interpretable, not a black box.

import type { CodeGraph } from "./codeAnalysis/types";
import { isTestFile } from "./codeAnalysis/testCoverage";
import { findDuplicateGroups } from "./codeAnalysis/duplicates";
import { deriveTestedFiles } from "./impact";
import { cmpStr } from "./deterministicSort";

/** Named safety tiers, most-load-bearing first. Ordering matters — the UI and
 *  the counts iterate in this order. */
export const SAFETY_TIERS = [
  "load-bearing",
  "handle-with-care",
  "moderate",
  "safe",
] as const;
export type SafetyTier = (typeof SAFETY_TIERS)[number];

/** A test file worth running before touching a given file, and how many of the
 *  affected files (the target + its dependents) it reaches. Static import/call
 *  mapping — NOT a coverage measurement. */
export interface TestToRun {
  file: string;
  guards: number;
}

export interface FileSafety {
  /** Repo-relative path. */
  file: string;
  /** The headline classification — always paired with the evidence below. */
  tier: SafetyTier;
  // --- Evidence (the receipts; the UI shows these, never a bare score) ---
  /** Distinct files that import or call into this one — how far a change
   *  ripples (direct fan-in). */
  dependents: number;
  /** Of those dependents, how many have NO test file reaching them — a
   *  regression here can break them silently. */
  untestedDependents: number;
  /** Aggregate cyclomatic complexity of the file (sum of decision points). */
  complexity: number;
  /** Functions in this file whose body is structurally duplicated elsewhere —
   *  change one copy and the others drift. */
  duplicatedFns: number;
  /** Does at least one test file reach this file (import or call). */
  tested: boolean;
  /** A capped sample of the untested dependents, for the drill-down "who
   *  breaks silently" list. Empty for low-risk files to bound the payload. */
  untestedDependentSample: string[];
  /** The Impact-Ranked Test Prioritizer result — test files that guard the
   *  affected set, most-guarding first. Only populated when `withTests` is set
   *  (a Plus feature) and only for the high tiers. Undefined otherwise. */
  testsToRun?: TestToRun[];
  /** Internal ordering key — NEVER surfaced to the user. */
  rank: number;
}

export interface RefactorSafetyReport {
  /** All meaningful (non-test) files, most load-bearing first. */
  files: FileSafety[];
  /** Count per tier, for the header summary. */
  counts: Record<SafetyTier, number>;
  /** Files considered (non-test files with code in the graph). */
  totalFiles: number;
}

/** A file a developer can actually RUN and see fail.
 *
 *  `isTestFile` is deliberately broad — anything under `tests/` counts, which is
 *  right for "don't score this as production code". It is wrong for "run these
 *  before you touch X": a conftest, a typing stub, a fixture app under
 *  `tests/test_apps/` can never be reported as a failing test. Measured on
 *  Flask: 31% of the six-slot budget was going to files that cannot fail. */
export function isRunnableTestFile(file: string): boolean {
  const base = file.slice(file.lastIndexOf("/") + 1);
  if (base === "conftest.py" || base.startsWith("__init__")) return false;
  return (
    /^test_.*\.py$/.test(base) ||
    /_test\.py$/.test(base) ||
    /\.(test|spec)\.[cm]?[jt]sx?$/.test(base) ||
    /^Test.*\.(java|kt|cs)$/.test(base) ||
    /_test\.(go|rb)$/.test(base) ||
    /^test_.*\.rb$/.test(base)
  );
}

// --- Tuning knobs. Heuristic + interpretable; evidence is always shown so a
//     reader can audit the tier regardless of where these land. ---
const HIGH_FANIN = 8; // "many files depend on this"
const SOME_FANIN = 3;
const HIGH_COMPLEXITY = 30; // aggregate file complexity that's genuinely hard
const SOME_COMPLEXITY = 20;
const SOME_UNTESTED = 3; // untested dependents that make a thin safety net
const SAMPLE_CAP = 12;

function classify(
  dependents: number,
  untestedDependents: number,
  complexity: number,
  duplicatedFns: number
): SafetyTier {
  // Load-bearing: wide reach AND a thin net (untested dependents) or genuinely
  // hard to change correctly (high complexity).
  if (
    dependents >= HIGH_FANIN &&
    (untestedDependents >= SOME_UNTESTED || complexity >= HIGH_COMPLEXITY)
  ) {
    return "load-bearing";
  }
  // Handle with care: wide reach (even if tested/simple), or moderate reach
  // with some risk, or a real duplication hazard.
  if (
    dependents >= HIGH_FANIN ||
    (dependents >= SOME_FANIN &&
      (untestedDependents >= 1 || complexity >= SOME_COMPLEXITY)) ||
    duplicatedFns >= 2
  ) {
    return "handle-with-care";
  }
  // Moderate: something depends on it, or it's non-trivial internally.
  if (dependents >= 1 || complexity >= 15 || duplicatedFns >= 1) {
    return "moderate";
  }
  return "safe";
}

/** Direct fan-in: target file → set of distinct source files that import or
 *  call into it. Test files are never a target (you don't "refactor into" a
 *  test) and self-edges don't count as a dependent. Exported so change-blast
 *  can union dependent SETS across files instead of summing counts (which
 *  double-counts a file that depends on several changed files). */
export function buildFanIn(cg: CodeGraph): Map<string, Set<string>> {
  const fanIn = new Map<string, Set<string>>();
  const add = (target: string | null | undefined, source: string) => {
    if (!target || !source || target === source || isTestFile(target)) return;
    let deps = fanIn.get(target);
    if (!deps) {
      deps = new Set<string>();
      fanIn.set(target, deps);
    }
    deps.add(source);
  };
  for (const e of cg.imports) add(e.to, e.from);
  for (const c of cg.calls) if (c.toFile) add(c.toFile, c.fromFile);
  return fanIn;
}

/** Compute the per-file refactor-safety report from a CodeGraph.
 *  `withTests` additionally computes the (Plus-gated) Test Prioritizer per
 *  high-tier file; leave it off for the free view so the data never ships. */
export function computeRefactorSafety(
  cg: CodeGraph,
  opts: { withTests?: boolean } = {}
): RefactorSafetyReport {
  // 1. Direct fan-in: target file → set of distinct source files. Test files
  //    are never a target (you don't "refactor into" a test), and self-edges
  //    don't count as a dependent.
  const fanIn = buildFanIn(cg);

  // 2. Which files a test reaches (has coverage).
  const tested = deriveTestedFiles(cg);

  // 3. Duplicated-function count per file (structural bodyHash duplicates).
  const duplicatedByFile = new Map<string, number>();
  for (const group of findDuplicateGroups(cg, { limit: 1_000_000 })) {
    for (const m of group.members) {
      duplicatedByFile.set(m.filePath, (duplicatedByFile.get(m.filePath) ?? 0) + 1);
    }
  }

  // 3b. (Plus) reverse test-mapping: prod file → the test files that reach it
  //     (import or call). Powers "run these tests before touching X".
  const testsByProd = new Map<string, Set<string>>();
  if (opts.withTests) {
    const addTest = (prod: string | null | undefined, source: string) => {
      if (!prod || !isTestFile(source) || isTestFile(prod)) return;
      let s = testsByProd.get(prod);
      if (!s) {
        s = new Set<string>();
        testsByProd.set(prod, s);
      }
      s.add(source);
    };
    for (const e of cg.imports) addTest(e.to, e.from);
    for (const c of cg.calls) if (c.toFile) addTest(c.toFile, c.fromFile);
  }

  // 4. The population of files to score: any non-test file that has code in the
  //    graph (complexity, functions, or an edge). Union of complexity keys,
  //    function paths, and fan-in targets.
  const population = new Set<string>();
  for (const p of Object.keys(cg.fileComplexity)) population.add(p);
  for (const fn of cg.functions) population.add(fn.filePath);
  for (const p of fanIn.keys()) population.add(p);

  const files: FileSafety[] = [];
  for (const file of population) {
    if (isTestFile(file)) continue;
    const deps = fanIn.get(file);
    const dependents = deps?.size ?? 0;
    const complexity = cg.fileComplexity[file] ?? 0;
    const duplicatedFns = duplicatedByFile.get(file) ?? 0;
    // Skip files that carry no signal at all (no code, no dependents) — keeps
    // the index to real, scoreable files.
    if (dependents === 0 && complexity === 0 && duplicatedFns === 0) continue;

    const untestedList: string[] = [];
    if (deps) {
      for (const d of deps) {
        if (!isTestFile(d) && !tested.has(d)) untestedList.push(d);
      }
    }
    const untestedDependents = untestedList.length;
    const tier = classify(dependents, untestedDependents, complexity, duplicatedFns);
    const highTier = tier === "load-bearing" || tier === "handle-with-care";

    // Test Prioritizer: rank test files by how many of the affected files
    // (this file + its dependents) they reach. Static import/call mapping.
    let testsToRun: TestToRun[] | undefined;
    if (opts.withTests && highTier) {
      const affected = new Set<string>([file]);
      if (deps) for (const d of deps) affected.add(d);
      const guardCounts = new Map<string, number>();
      for (const a of affected) {
        const ts = testsByProd.get(a);
        if (ts) {
          for (const t of ts) {
            if (!isRunnableTestFile(t)) continue;
            guardCounts.set(t, (guardCounts.get(t) ?? 0) + 1);
          }
        }
      }
      // Ranking, in priority order. `guards` alone is BREADTH — how many of
      // the affected files a test happens to touch — and breadth is the wrong
      // thing to put in the top slots. Measured against a mutation oracle
      // (bench/mutationOracle.ts): 5 of 6 tests that actually caught a break
      // were in this candidate set and got sorted below the cut, including
      // `testCoverage.test.ts` for `testCoverage.ts` — the test named after the
      // file, ranked out by broader tests that catch nothing.
      //
      //  1. reaches the CHANGED FILE itself, not merely something downstream
      //  2. named after it (foo.test.ts guards foo.ts)
      //  3. then breadth, then path, for a stable order
      const directTests = testsByProd.get(file);
      const base = file.slice(file.lastIndexOf("/") + 1).replace(/\.[^.]+$/, "");
      // Exact name beats a prefix beats nothing. The prefix rung matters more
      // than it looks: with 20 candidates all importing `storage.ts` directly,
      // the direct-reach test cannot discriminate and the order collapses to
      // alphabetical — `badgeRoute`, `demoHighlights`, `evidenceRoute` win on
      // their first letter while `storageDeleteByInstallation` sits below the
      // cut. Measured: that one file was 0 of 2 before this rung.
      const affinity = (t: string) => {
        const tb = t.slice(t.lastIndexOf("/") + 1).replace(/\.(test|spec)\.[^.]+$/, "");
        if (tb === base) return 2;
        return tb.toLowerCase().startsWith(base.toLowerCase()) ? 1 : 0;
      };
      testsToRun = [...guardCounts.entries()]
        .map(([f, guards]) => ({ file: f, guards }))
        .sort(
          (a, b) =>
            Number(directTests?.has(b.file) ?? false) - Number(directTests?.has(a.file) ?? false) ||
            affinity(b.file) - affinity(a.file) ||
            b.guards - a.guards ||
            cmpStr(a.file, b.file),
        )
        .slice(0, 6);
    }

    files.push({
      file,
      tier,
      dependents,
      untestedDependents,
      complexity,
      duplicatedFns,
      tested: tested.has(file),
      // Only carry the sample for the tiers whose drill-down matters — bounds
      // the payload on big repos.
      untestedDependentSample: highTier ? untestedList.sort().slice(0, SAMPLE_CAP) : [],
      testsToRun,
      rank:
        dependents * 2 +
        untestedDependents * 3 +
        complexity * 0.5 +
        duplicatedFns * 2,
    });
  }

  files.sort((a, b) => b.rank - a.rank || cmpStr(a.file, b.file));

  const counts = { "load-bearing": 0, "handle-with-care": 0, moderate: 0, safe: 0 } as Record<
    SafetyTier,
    number
  >;
  for (const f of files) counts[f.tier]++;

  return { files, counts, totalFiles: files.length };
}
