// The Read — Merge Confidence (Mode B).
//
// The PR-scoped twin of the adoption read: turns a single base->head diff into
// one call — SAFE TO MERGE / REVIEW CLOSELY / HIGH BLAST — plus the ranked list
// of the riskiest touched functions and a "safe parts" line. It's the
// explorable "why" behind the terse PR-bot comment.
//
// Invents no new analysis — it orchestrates the same pure engines the PR-bot
// pipeline already uses:
//   - computeDiff(base, head)            -> the touched functions
//   - computeFunctionBlastRadius(...)    -> who depends on each touched function
//   - computeTestCoverage(graph)         -> which touched functions have 0 test callers
//   - evaluateVerificationRules({ diff })-> the same prioritized suggestions the bot posts
//
// Risk per touched function = (1 + transitive callers) x complexity factor,
// amplified when it's untested and when it's a removal that still has callers.
// Orange is rationed to a HIGH BLAST read only (mirrors the adoption card,
// where orange is reserved for AVOID).

import type { CodeGraph } from "../codeAnalysis/types";
import { computeDiff, type DiffResult, type DiffSummary } from "../codeAnalysis/diffAware";
import { computeFunctionBlastRadius } from "../codeAnalysis/blastRadius";
import { computeTestCoverage } from "../codeAnalysis/testCoverage";
import {
  evaluateVerificationRules,
  type VerificationSuggestion,
} from "../codeAnalysis/verificationRules";

export type MergeConfidenceLevel = "SAFE TO MERGE" | "REVIEW CLOSELY" | "HIGH BLAST";

export interface RiskyFunction {
  /** Stable key for React + the critical marker: file::container::name. */
  key: string;
  filePath: string;
  name: string;
  containerType?: string;
  status: "added" | "removed" | "modified";
  /** Transitive incoming callers (the blast). */
  callers: number;
  /** Direct (1-hop) callers. */
  directCallers: number;
  /** Callers living outside the function's own module/dir. */
  crossModule: number;
  complexity: number;
  complexityDelta?: number;
  /** No direct test caller reaches this function. */
  untested: boolean;
  riskScore: number;
}

export interface MergeConfidenceRead {
  read: MergeConfidenceLevel;
  headline: string;
  /** Touched functions, riskiest first (capped). */
  riskiest: RiskyFunction[];
  /** "N of M touched functions look low-risk." Omitted when nothing changed. */
  safeParts?: string;
  summary: DiffSummary;
  /** The PR-bot's own prioritized verification suggestions, expanded. */
  suggestions: VerificationSuggestion[];
  /** The single HIGH-BLAST function — the UI paints this one orange. */
  criticalFnKey?: string;
  /** Set when blast was computed for only a subset (very large diffs). */
  truncatedNote?: string;
}

// Thresholds — the SAFE / REVIEW / HIGH-BLAST rules. Tunable product knobs.
const HIGH_CALLERS = 10; // an untested touched fn with >= this many callers -> HIGH BLAST
const MED_CALLERS = 3; // an untested touched fn with >= this many callers -> REVIEW
const REMOVED_DIRECT = 3; // a removed fn with >= this many direct callers -> HIGH BLAST
const BIG_DIFF_FILES = 10;
const BIG_DIFF_FNS = 15;
const BLAST_CAP = 60; // max functions we run the BFS on (bounds cost on huge diffs)
const TOP_RISKIEST = 6;

// Internal identity key. Both the untested Set (built from computeTestCoverage's
// untestedHotspots OUTPUT objects) and the per-touched-function lookup go
// through this same function, so it only needs internal consistency — it does
// NOT need to match testCoverage's private key. We still use the codebase's
// \x1E (record-separator) convention + file-name-container order so the key is
// collision-proof and consistent with diffAware/blastRadius identity keys.
function fnKey(filePath: string, name: string, containerType?: string): string {
  return `${filePath}\x1E${name}\x1E${containerType ?? ""}`;
}

/** Build the set of "no direct test caller" function keys for a graph. We pass
 *  an effectively-unbounded limit so untestedHotspots is the COMPLETE list,
 *  not the top-10 panel view. */
function untestedKeySet(graph: CodeGraph): Set<string> {
  const cov = computeTestCoverage(graph, {
    untestedHotspotsLimit: Number.MAX_SAFE_INTEGER,
  });
  return new Set(
    cov.untestedHotspots.map((h) => fnKey(h.filePath, h.name, h.containerType))
  );
}

const HEADLINE: Record<MergeConfidenceLevel, string> = {
  "SAFE TO MERGE": "Low blast radius — this looks safe to merge.",
  "REVIEW CLOSELY": "Mergeable, but a few touched areas deserve a closer look.",
  "HIGH BLAST": "This change ripples wide into untested code — review before merging.",
};

/**
 * Compute the merge-confidence read for a base->head pair. Both graphs are
 * required (the route guards on codeGraph presence). Pure + deterministic.
 */
export function computeMergeConfidenceRead(
  baseGraph: CodeGraph,
  headGraph: CodeGraph
): MergeConfidenceRead {
  const diff: DiffResult = computeDiff(baseGraph, headGraph);
  const touched = diff.changes.filter((c) => c.status !== "unchanged");

  if (touched.length === 0) {
    return {
      read: "SAFE TO MERGE",
      headline: "No function-level changes between these refs.",
      riskiest: [],
      summary: diff.summary,
      suggestions: evaluateVerificationRules({ diff }, { maxResults: 5 }),
    };
  }

  const headUntested = untestedKeySet(headGraph);
  const baseUntested = untestedKeySet(baseGraph);

  // Bound the BFS cost: only the most-complex touched functions get a blast
  // walk; the long tail of trivial edits is assumed low-risk.
  const preRank = (c: (typeof touched)[number]) =>
    (c.complexityAfter ?? c.complexityBefore ?? 0) +
    Math.abs(c.complexityDelta ?? 0);
  const targets = [...touched].sort((a, b) => preRank(b) - preRank(a));
  const blastTargets = targets.slice(0, BLAST_CAP);
  const truncatedNote =
    targets.length > BLAST_CAP
      ? `Blast measured for the ${BLAST_CAP} most-complex of ${targets.length} touched functions.`
      : undefined;

  const risky: RiskyFunction[] = blastTargets.map((c) => {
    // For a removal, the risk is "who called it in the BASE"; for adds/mods,
    // who depends on it in the HEAD.
    const graph = c.status === "removed" ? baseGraph : headGraph;
    const blast = computeFunctionBlastRadius(graph, c.filePath, c.name, {
      targetContainerType: c.containerType,
    });
    const callers = blast.incoming.length;
    const directCallers = blast.byHop.incoming[1] ?? 0;
    const crossModule = blast.crossModuleCounts.incoming;
    const complexity = c.complexityAfter ?? c.complexityBefore ?? 0;
    const key = fnKey(c.filePath, c.name, c.containerType);
    const untested = (c.status === "removed" ? baseUntested : headUntested).has(
      key
    );
    const riskScore =
      (1 + callers) *
      (1 + complexity / 10) *
      (untested ? 1.8 : 1) *
      (c.status === "removed" ? 1.5 : 1);
    return {
      key,
      filePath: c.filePath,
      name: c.name,
      containerType: c.containerType,
      status: c.status as RiskyFunction["status"],
      callers,
      directCallers,
      crossModule,
      complexity,
      complexityDelta: c.complexityDelta,
      untested,
      riskScore,
    };
  });

  risky.sort((a, b) => b.riskScore - a.riskScore);

  const highBlast = risky.some(
    (r) =>
      (r.untested && r.callers >= HIGH_CALLERS) ||
      (r.status === "removed" && r.directCallers >= REMOVED_DIRECT)
  );
  const reviewClosely =
    risky.some((r) => r.untested && r.callers >= MED_CALLERS) ||
    risky.some((r) => r.status === "removed" && r.directCallers >= 1) ||
    diff.summary.filesChanged >= BIG_DIFF_FILES ||
    diff.summary.functionsAdded + diff.summary.functionsModified >= BIG_DIFF_FNS;
  const read: MergeConfidenceLevel = highBlast
    ? "HIGH BLAST"
    : reviewClosely
      ? "REVIEW CLOSELY"
      : "SAFE TO MERGE";

  const flagged = risky.filter(
    (r) =>
      (r.untested && r.callers >= MED_CALLERS) ||
      (r.status === "removed" && r.directCallers >= 1)
  ).length;
  // Count only the functions we ACTUALLY measured (blastTargets), never the
  // un-analyzed long tail — otherwise a truncated diff would overstate safety.
  const analyzed = blastTargets.length;
  const lowRisk = analyzed - flagged;
  const safeParts =
    lowRisk > 0
      ? `${lowRisk} of ${analyzed} analyzed function${analyzed === 1 ? "" : "s"} look low-risk${
          targets.length > BLAST_CAP ? " (the lower-complexity tail wasn't measured)" : ""
        }.`
      : undefined;

  const riskiest = risky.slice(0, TOP_RISKIEST);

  return {
    read,
    headline: HEADLINE[read],
    riskiest,
    safeParts,
    summary: diff.summary,
    suggestions: evaluateVerificationRules({ diff }, { maxResults: 5 }),
    // Orange is rationed: a critical (orange) function only on a HIGH BLAST read.
    criticalFnKey: read === "HIGH BLAST" ? riskiest[0]?.key : undefined,
    truncatedNote,
  };
}
