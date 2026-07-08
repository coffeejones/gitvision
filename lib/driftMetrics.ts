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
import { computeTestCoverage } from "./codeAnalysis/testCoverage";
import {
  findDuplicateGroups,
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
    findDuplicateGroups(cg, { limit: 1_000_000 })
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
