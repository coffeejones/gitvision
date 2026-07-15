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
import type { CodeGraph, FunctionDef } from "@/lib/codeAnalysis/types";
import { computeRefactorSafety, type SafetyTier } from "@/lib/refactorSafety";
import { isTestFile } from "@/lib/codeAnalysis/testCoverage";
import { findDuplicateGroups } from "@/lib/codeAnalysis/duplicates";

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
  /** Vs the previous snapshot (the "update angle"): a function that didn't
   *  exist then is "new", one whose body hash moved is "modified". Undefined
   *  when unchanged, when there's no previous snapshot, or when body hashes
   *  aren't available to compare (non-JS/TS, or a cross-analyzer-version diff). */
  changed?: "new" | "modified";
  /** Other locations whose function body is structurally identical to this one
   *  (same bodyHash). Present only when this function has ≥1 twin elsewhere. */
  duplicates?: { path: string; line: number }[];
}

/** Index the code graph's structural-duplicate groups by body hash — a
 *  Map<bodyHash, members> the route builds once and hands to functionMarkersFor
 *  so each function can find its twins. */
export function duplicateIndex(cg: CodeGraph): Map<string, FunctionDef[]> {
  const byHash = new Map<string, FunctionDef[]>();
  for (const group of findDuplicateGroups(cg, { limit: 1_000_000 })) {
    const hash = group.members[0]?.bodyHash;
    if (hash) byHash.set(hash, group.members);
  }
  return byHash;
}

/** Identify a function within a file across snapshots — name, disambiguated by
 *  its container (class/struct) when known. Good enough for the change diff;
 *  a rename reads as new, which is the honest default. */
function fnKey(f: { name: string; containerType?: string }): string {
  return f.containerType ? `${f.containerType}.${f.name}` : f.name;
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
 *  functions. Called by the source route per opened file. When `prevCg` (the
 *  previous snapshot's graph) is given, each marker is tagged new/modified vs it
 *  — the "since last visit" layer. */
export function functionMarkersFor(
  cg: CodeGraph,
  path: string,
  prevCg?: CodeGraph | null,
  dupes?: Map<string, FunctionDef[]> | null,
): FnMarker[] {
  const prev = prevCg
    ? new Map(
        prevCg.functions
          .filter((f) => f.filePath === path)
          .map((f) => [fnKey(f), f]),
      )
    : null;

  return cg.functions
    .filter((f) => f.filePath === path)
    .map((f) => {
      const marker: FnMarker = {
        name: f.name,
        startRow: f.startRow,
        endRow: f.endRow,
        complexity: f.complexity,
      };
      if (prev) {
        const before = prev.get(fnKey(f));
        if (!before) {
          marker.changed = "new";
        } else if (f.bodyHash && before.bodyHash && f.bodyHash !== before.bodyHash) {
          // Only claim "modified" when BOTH sides carry a body hash — otherwise
          // an absent hash (regex-fallback language, or an older analyzer) would
          // masquerade as a change.
          marker.changed = "modified";
        }
      }
      if (dupes && f.bodyHash) {
        const group = dupes.get(f.bodyHash);
        if (group) {
          const twins = group
            .filter((m) => !(m.filePath === f.filePath && m.startRow === f.startRow))
            .map((m) => ({ path: m.filePath, line: m.startRow + 1 }));
          if (twins.length > 0) marker.duplicates = twins;
        }
      }
      return marker;
    });
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
