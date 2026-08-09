// Drift metrics — a small, stable per-snapshot fingerprint of codebase health,
// persisted on every AnalysisSnapshot so future snapshots can diff against it
// into trends ("duplication rose 34% over 3 sweeps"). This is the foundation
// of the temporal-intelligence arc: drift CAN'T be backfilled, so we start
// capturing now even though the trend UI ships later.
//
// Pure over the CodeGraph and client-safe (composes the same pure helpers the
// panels use). Numbers are rounded so tiny float jitter between snapshots
// doesn't read as real drift.

import type { CodeGraph } from "./codeAnalysis/types";
import type { AnalysisSnapshot } from "./types";
import { computeTestCoverage } from "./codeAnalysis/testCoverage";
import {
  allDuplicateGroups,
  summarizeDuplicates,
} from "./codeAnalysis/duplicates";

export interface DriftMetrics {
  /** Code files analyzed (files with a complexity entry). */
  files: number;
  /** Total functions across all files. */
  functions: number;
  /** Mean aggregate file complexity. */
  avgComplexity: number;
  /** Worst single-file complexity — the hardest file to change. */
  maxComplexity: number;
  /** Percent of functions that are structural duplicates (in a dup group,
   *  complexity >= 5). 0-100. */
  duplicationPct: number;
  /** Percent of prod functions with at least one direct test caller. 0-100. */
  prodFnCoveragePct: number;
  /** Resolved call edges per function — a coupling / connectivity proxy that
   *  rises as the graph tangles. */
  connectivity: number;
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Compute the drift fingerprint for a snapshot's code graph. */
export function computeDriftMetrics(cg: CodeGraph): DriftMetrics {
  const complexities = Object.values(cg.fileComplexity);
  const files = complexities.length;
  const functions = cg.functions.length;

  const totalComplexity = complexities.reduce((a, b) => a + b, 0);
  const avgComplexity = files > 0 ? round2(totalComplexity / files) : 0;
  const maxComplexity = complexities.length ? Math.max(...complexities) : 0;

  // All duplicate groups (uncapped) so the percentage is accurate, not the
  // top-15 the panel shows.
  const dup = summarizeDuplicates(
    allDuplicateGroups(cg)
  );
  const duplicationPct =
    functions > 0
      ? round1((dup.totalDuplicateFunctions / functions) * 100)
      : 0;

  const cov = computeTestCoverage(cg).totals;
  const prodFnCoveragePct =
    cov.prodFunctions > 0
      ? round1((cov.testedProdFunctions / cov.prodFunctions) * 100)
      : 0;

  const resolvedCalls = cg.calls.filter((c) => c.toFile != null).length;
  const connectivity = functions > 0 ? round2(resolvedCalls / functions) : 0;

  return {
    files,
    functions,
    avgComplexity,
    maxComplexity,
    duplicationPct,
    prodFnCoveragePct,
    connectivity,
  };
}

// ---------------------------------------------------------------------------
// Drift trends — diff a session's snapshots into a "direction of travel"
// report ("duplication rose 34% over 3 sweeps"). This is the display layer of
// the temporal arc: it reads the persisted fingerprints but falls back to
// computing them on the fly, so trends work retroactively for snapshots taken
// before the fingerprint was persisted.
// ---------------------------------------------------------------------------

/** The subset of a snapshot the drift math needs — narrowed so callers (and
 *  tests) don't have to build a whole AnalysisSnapshot. */
type DriftInput = Pick<
  AnalysisSnapshot,
  "fetchedAt" | "driftMetrics" | "codeGraph"
>;

/** Metrics for a snapshot: the persisted fingerprint if present, else computed
 *  on the fly from its code graph. Null when there's no code graph to measure
 *  (so the snapshot is skipped from the trend). */
export function driftMetricsFor(s: DriftInput): DriftMetrics | null {
  if (s.driftMetrics) return s.driftMetrics;
  return s.codeGraph ? computeDriftMetrics(s.codeGraph) : null;
}

/** One metric's movement between the baseline and latest sweep. */
export interface DriftTrend {
  key:
    | "duplicationPct"
    | "prodFnCoveragePct"
    | "avgComplexity"
    | "maxComplexity"
    | "connectivity";
  label: string;
  from: number;
  to: number;
  /** to - from, rounded. */
  delta: number;
  unit: "%" | "cx" | "×";
  /** True when the movement is in the unhealthy direction (duplication up,
   *  coverage down, complexity up, coupling up). Drives the color + copy. */
  worse: boolean;
}

export interface DriftReport {
  /** False until there are 2+ measurable snapshots to compare. */
  hasBaseline: boolean;
  /** ISO timestamp of the earliest measurable snapshot. */
  baselineAt?: string;
  /** ISO timestamp of the latest measurable snapshot. */
  latestAt?: string;
  /** How many measurable snapshots span the trend. */
  sweeps: number;
  /** Metrics that moved beyond a per-metric noise floor, worst-first. */
  trends: DriftTrend[];
  /** Full fingerprints at the span endpoints, for renderers that want the raw
   *  "then vs now" numbers (e.g. the share card). Present only when
   *  hasBaseline. */
  baseline?: DriftMetrics;
  latest?: DriftMetrics;
}

/** Per-metric config: display label, unit, which direction is unhealthy, and a
 *  noise floor below which a movement isn't worth reporting (rounding jitter,
 *  a single renamed function). Order is the tiebreak when magnitudes match. */
const TREND_METRICS: ReadonlyArray<{
  key: DriftTrend["key"];
  label: string;
  unit: DriftTrend["unit"];
  higherIsWorse: boolean;
  threshold: number;
}> = [
  { key: "duplicationPct", label: "Duplication", unit: "%", higherIsWorse: true, threshold: 1 },
  { key: "prodFnCoveragePct", label: "Test coverage", unit: "%", higherIsWorse: false, threshold: 1 },
  { key: "maxComplexity", label: "Worst-file complexity", unit: "cx", higherIsWorse: true, threshold: 2 },
  { key: "avgComplexity", label: "Avg complexity", unit: "cx", higherIsWorse: true, threshold: 0.5 },
  { key: "connectivity", label: "Coupling", unit: "×", higherIsWorse: true, threshold: 0.1 },
];

/** All five quality-metric movements between two fingerprints, each tagged
 *  `moved` when it crossed its noise floor. computeDriftTrends surfaces only
 *  the moved ones (the panel); the share card renders the full set with stable
 *  rows muted, so it always shows the complete fingerprint. */
export function driftRows(
  from: DriftMetrics,
  to: DriftMetrics
): Array<DriftTrend & { moved: boolean }> {
  return TREND_METRICS.map((cfg) => {
    const a = from[cfg.key];
    const b = to[cfg.key];
    const delta = round2(b - a);
    const moved = Math.abs(delta) >= cfg.threshold;
    const worse = cfg.higherIsWorse ? delta > 0 : delta < 0;
    return { key: cfg.key, label: cfg.label, from: a, to: b, delta, unit: cfg.unit, worse, moved };
  });
}

/** Diff a session's snapshots (oldest → newest) into a drift report. Compares
 *  the earliest measurable snapshot against the latest — the full span, so the
 *  story is "since you first looked" rather than only "since last sweep". */
export function computeDriftTrends(
  snapshots: ReadonlyArray<DriftInput>
): DriftReport {
  // "Measurable" = carries a persisted fingerprint OR a code graph to derive
  // one from. This is a cheap presence check (no compute), so we can pick the
  // span endpoints first and only run the (potentially graph-walking) metric
  // computation on the two snapshots we actually compare — not every one.
  const measurable = snapshots.filter((s) => s.driftMetrics || s.codeGraph);
  if (measurable.length < 2) {
    return { hasBaseline: false, sweeps: measurable.length, trends: [] };
  }

  const baseSnap = measurable[0];
  const lastSnap = measurable[measurable.length - 1];
  const baseline = driftMetricsFor(baseSnap)!; // non-null: measurable
  const latest = driftMetricsFor(lastSnap)!;

  // Only the metrics that crossed their noise floor, worst-first.
  const trends: DriftTrend[] = driftRows(baseline, latest).filter((r) => r.moved);

  // Worst-first: regressions before improvements, then by magnitude.
  trends.sort(
    (a, b) =>
      Number(b.worse) - Number(a.worse) || Math.abs(b.delta) - Math.abs(a.delta)
  );

  return {
    hasBaseline: true,
    baselineAt: baseSnap.fetchedAt,
    latestAt: lastSnap.fetchedAt,
    sweeps: measurable.length,
    trends,
    baseline,
    latest,
  };
}
