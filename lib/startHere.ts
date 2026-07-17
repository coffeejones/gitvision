// "Start here" — the onboarding tour for the Source view. Given the per-file
// chips (already computed for the Source view), rank the handful of files a
// newcomer should read FIRST to build a mental model of the repo.
//
// This is a different question from recommendations.ts ("what to fix"): it's
// "what to read to understand this". So the ranking leads with CENTRALITY
// (fan-in — the keystones everything depends on), then significance
// (complexity), then recency (churn — what's actively moving). Deterministic
// and grounded: every item's one-line reason is a true fact about the file, no
// AI, no guesswork.

import type { FileChips } from "./sourceAnnotations";

export interface StartHereItem {
  path: string;
  /** One honest line on why to read this first, led by its strongest signal. */
  reason: string;
  fanIn: number;
  complexity: number | null;
  churn: number | null;
}

/** The strongest true fact about a file, as its "why read this" line. */
function reasonFor(c: FileChips): string {
  if (c.fanIn >= 3) {
    return `${c.fanIn} files depend on this — a keystone worth understanding first`;
  }
  if (c.tier === "load-bearing") {
    return "Load-bearing — a change here ripples widely, so learn it early";
  }
  if ((c.complexity ?? 0) >= 15) {
    return `The most involved logic here (complexity ${c.complexity})`;
  }
  if (c.churn != null && c.churn >= 5) {
    return `Actively changing — ${c.churn} recent commits`;
  }
  if (c.fanIn >= 1) {
    return c.fanIn === 1 ? "1 file depends on this" : `${c.fanIn} files depend on this`;
  }
  return `A substantial piece of the codebase (complexity ${c.complexity ?? "n/a"})`;
}

// A "read this first" keystone must have real LOGIC, not just be imported
// everywhere. Pure-vocabulary files — type definitions, design tokens, barrels
// — carry huge fan-in but ~zero complexity, and reading them teaches you nothing
// about how the code actually works. So a file qualifies only with BOTH
// centrality (fan-in) AND substance (aggregate complexity above this floor).
// File complexity is 1 + decision points, so pure vocabulary sits at ~1 while
// any genuine logic clears the floor comfortably.
const SUBSTANCE_FLOOR = 8;

/** Rank the top `limit` files to read first: the central files that also carry
 *  real logic. Skips test files, config, and pure-vocabulary files (types,
 *  tokens, barrels) — high fan-in but nothing to understand. Returns [] when
 *  nothing qualifies. */
export function rankStartHere(
  chips: Record<string, FileChips>,
  limit = 6,
): StartHereItem[] {
  const entries = Object.entries(chips).filter(
    ([, c]) => !c.isTest && c.fanIn >= 1 && (c.complexity ?? 0) >= SUBSTANCE_FLOOR,
  );
  if (entries.length === 0) return [];

  // Normalize each signal to 0..1 so the blend is balanced regardless of repo
  // size, then weight: centrality dominates, significance strong, recency a
  // tiebreaker.
  const maxFanIn = Math.max(1, ...entries.map(([, c]) => c.fanIn));
  const maxComplexity = Math.max(1, ...entries.map(([, c]) => c.complexity ?? 0));
  const maxChurn = Math.max(1, ...entries.map(([, c]) => c.churn ?? 0));

  return entries
    .map(([path, c]) => ({
      path,
      c,
      score:
        (c.fanIn / maxFanIn) * 6 +
        ((c.complexity ?? 0) / maxComplexity) * 4 +
        ((c.churn ?? 0) / maxChurn) * 2,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ path, c }) => ({
      path,
      reason: reasonFor(c),
      fanIn: c.fanIn,
      complexity: c.complexity,
      churn: c.churn,
    }));
}
