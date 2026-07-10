// Weak-Suite — the analysis behind the "coverage that means nothing" signal
// (Arc 1). Pure over the CodeGraph's per-test-file assertion metadata, which the
// language plugins extract. This layer knows NO language idioms (no `expect`, no
// matcher names) — only arithmetic and honest tiers. Every tier is backed by the
// raw counts the UI always shows ("publish the math"), never a bare 0-100 score.
//
// A test case is "smoke-only" when it executes code but verifies nothing that
// would catch a regression: zero assertions, or only trivial oracles
// (existence / truthiness / did-not-throw). The plugin decides which idioms are
// trivial; this file just counts what it was handed.

import type { CodeGraph, TestCaseMeta } from "./codeAnalysis/types";

/** File tiers, worst-first (ordering matters — UI + counts iterate in order). */
export const WEAK_SUITE_TIERS = ["hollow", "thin", "solid"] as const;
export type WeakSuiteTier = (typeof WEAK_SUITE_TIERS)[number];

export interface WeakTestFile {
  file: string;
  tier: WeakSuiteTier;
  testCases: number;
  assertions: number;
  /** assertions / testCases (2dp). */
  assertionDensity: number;
  /** Cases with no meaningful oracle (0 assertions, or only trivial ones). */
  smokeOnlyCases: number;
  /** smokeOnlyCases / testCases, 0..1 (2dp). */
  smokeOnlyRatio: number;
  /** Distinct trivial-oracle idiom names found in the file (evidence). */
  trivialOracleNames: string[];
  /** Per-case breakdown — present only when computed withDetail (Plus). */
  cases?: TestCaseMeta[];
  /** Internal ordering key — never surfaced. */
  rank: number;
}

export interface WeakSuiteTotals {
  testFiles: number;
  testCases: number;
  assertions: number;
  smokeOnlyCases: number;
  /** Repo-wide assertions / testCases (2dp). */
  assertionDensity: number;
  /** Repo-wide smokeOnlyCases / testCases (2dp). */
  smokeOnlyRatio: number;
}

export interface WeakSuiteReport {
  files: WeakTestFile[];
  counts: Record<WeakSuiteTier, number>;
  totals: WeakSuiteTotals;
}

/** Aggregate-only summary — no file list, no per-case detail. Safe to persist
 *  on a snapshot and ship to any tier; drives the health signal + tiles. */
export interface WeakSuiteSummary {
  counts: Record<WeakSuiteTier, number>;
  totals: WeakSuiteTotals;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function isSmokeOnly(c: TestCaseMeta): boolean {
  return c.assertions === 0 || !c.hasMeaningfulOracle;
}

/** Thresholds are heuristic + interpretable (never a black box). Hollow = half
 *  or more of a file's cases verify nothing meaningful. Thin = a real minority
 *  are smoke-only, or the suite is thinly asserted overall (<1 assertion/case). */
function classify(smokeOnlyRatio: number, assertionDensity: number): WeakSuiteTier {
  if (smokeOnlyRatio >= 0.5) return "hollow";
  if (smokeOnlyRatio >= 0.2 || assertionDensity < 1) return "thin";
  return "solid";
}

const TIER_WEIGHT: Record<WeakSuiteTier, number> = { hollow: 1000, thin: 500, solid: 0 };

/** Compute the per-test-file Weak-Suite report from a CodeGraph.
 *  `withDetail` additionally carries the per-test-case breakdown (a Plus-gated
 *  drill-down); leave it off so the case-level data never ships to free users.
 *  Returns null when the graph has no test-file metadata (non-JS repos, legacy
 *  snapshots, or a repo with no recognised test cases). */
export function computeWeakSuite(
  cg: CodeGraph,
  opts: { withDetail?: boolean } = {}
): WeakSuiteReport | null {
  const testFiles = cg.testFiles;
  if (!testFiles || testFiles.length === 0) return null;

  const files: WeakTestFile[] = [];
  const counts: Record<WeakSuiteTier, number> = { hollow: 0, thin: 0, solid: 0 };
  let totCases = 0;
  let totAssertions = 0;
  let totSmoke = 0;

  for (const tf of testFiles) {
    const testCases = tf.cases.length;
    if (testCases === 0) continue;
    const assertions = tf.cases.reduce((s, c) => s + c.assertions, 0);
    const smokeOnlyCases = tf.cases.filter(isSmokeOnly).length;
    const assertionDensity = round2(assertions / testCases);
    const smokeOnlyRatio = round2(smokeOnlyCases / testCases);
    const tier = classify(smokeOnlyRatio, assertionDensity);
    counts[tier]++;
    totCases += testCases;
    totAssertions += assertions;
    totSmoke += smokeOnlyCases;
    files.push({
      file: tf.file,
      tier,
      testCases,
      assertions,
      assertionDensity,
      smokeOnlyCases,
      smokeOnlyRatio,
      trivialOracleNames: tf.trivialOracleNames,
      cases: opts.withDetail ? tf.cases : undefined,
      rank: TIER_WEIGHT[tier] + smokeOnlyCases,
    });
  }

  if (totCases === 0) return null;

  files.sort((a, b) => b.rank - a.rank || a.file.localeCompare(b.file));

  return {
    files,
    counts,
    totals: {
      testFiles: files.length,
      testCases: totCases,
      assertions: totAssertions,
      smokeOnlyCases: totSmoke,
      assertionDensity: round2(totAssertions / totCases),
      smokeOnlyRatio: round2(totSmoke / totCases),
    },
  };
}

/** The aggregate summary of a report (or null), for persisting on a snapshot. */
export function weakSuiteSummary(report: WeakSuiteReport | null): WeakSuiteSummary | undefined {
  if (!report) return undefined;
  return { counts: report.counts, totals: report.totals };
}
