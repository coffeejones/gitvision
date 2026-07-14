// The annotation layer for the Source view — what turns a blob viewer into
// CodeTrawl. Everything here is a reshape of already-computed analysis; no new
// signal is invented, and every number traces back to a source-of-truth pass
// (computeRefactorSafety, the hotspot list, the code graph's functions).
//
// Split by cost: the per-file CHIPS come from computeRefactorSafety, an O(graph)
// pass, so the page computes them once for every file and hands them down. The
// per-line FUNCTION markers are a cheap per-path filter, so the source route
// returns them lazily with each opened file (sending every function for every
// file up front would be a megabyte on a large repo).

import type { AnalysisSnapshot } from "@/lib/types";
import type { CodeGraph } from "@/lib/codeAnalysis/types";
import { computeRefactorSafety, type SafetyTier } from "@/lib/refactorSafety";
import { isTestFile } from "@/lib/codeAnalysis/testCoverage";

/** Per-file header chips. All fields optional-ish: a test file or a file with no
 *  safety entry leaves the code-risk fields null, and a repo with no git history
 *  leaves churn/authors null. */
export interface FileChips {
  isTest: boolean;
  /** Refactor-safety classification, or null for test/unclassified files. */
  tier: SafetyTier | null;
  /** Does a test file reach this one? null when not meaningfully testable. */
  tested: boolean | null;
  /** Direct importers/callers — how far a change ripples (FileSafety.dependents). */
  fanIn: number;
  /** Of those dependents, how many have no test reaching them. */
  untestedDependents: number;
  /** Aggregate cyclomatic complexity of the file. */
  complexity: number | null;
  /** Functions whose body is structurally duplicated elsewhere. */
  duplicatedFns: number;
  /** Commits that touched this file (git hotspot), or null with no history. */
  churn: number | null;
  /** Unique authors who touched it. authors === 1 is the bus-factor signal. */
  authors: number | null;
}

/** One function's line marker, placed at its start line in the gutter. */
export interface FnMarker {
  name: string;
  /** 0-indexed (tree-sitter) — the caller adds 1 for the displayed line. */
  startRow: number;
  endRow: number;
  complexity: number;
}

/** Compute the header chips for every analyzed file, keyed by path. One O(graph)
 *  pass (computeRefactorSafety) + a hotspot index — the same cost as opening the
 *  Refactor tab. */
export function computeFileChips(
  snapshot: AnalysisSnapshot,
): Record<string, FileChips> {
  const cg = snapshot.codeGraph;
  if (!cg) return {};

  const safetyByPath = new Map(
    computeRefactorSafety(cg, { withTests: false }).files.map((f) => [f.file, f]),
  );
  const hotspotByPath = new Map(
    (snapshot.hotspots ?? []).map((h) => [h.path, h]),
  );

  const out: Record<string, FileChips> = {};
  for (const path of Object.keys(cg.contentHashes ?? {})) {
    const s = safetyByPath.get(path);
    const h = hotspotByPath.get(path);
    out[path] = {
      isTest: isTestFile(path),
      tier: s?.tier ?? null,
      tested: s ? s.tested : null,
      fanIn: s?.dependents ?? 0,
      untestedDependents: s?.untestedDependents ?? 0,
      complexity: s?.complexity ?? cg.fileComplexity?.[path] ?? null,
      duplicatedFns: s?.duplicatedFns ?? 0,
      churn: h?.churn ?? null,
      authors: h?.authors ?? null,
    };
  }
  return out;
}

/** The per-function line markers for one file — a cheap filter of the graph's
 *  functions. Called by the source route per opened file. */
export function functionMarkersFor(cg: CodeGraph, path: string): FnMarker[] {
  return cg.functions
    .filter((f) => f.filePath === path)
    .map((f) => ({
      name: f.name,
      startRow: f.startRow,
      endRow: f.endRow,
      complexity: f.complexity,
    }));
}

export type ComplexityTone = "high" | "medium";

/** Only mark functions worth a glance — trivial ones get no gutter marker, so the
 *  view stays quiet. >=15 reads as "hard to hold in your head", 8-14 as "getting
 *  there". Below 8: no marker. */
export function complexityTone(complexity: number): ComplexityTone | null {
  if (complexity >= 15) return "high";
  if (complexity >= 8) return "medium";
  return null;
}
