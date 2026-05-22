// Pre-built demo session → rich card data (v0.76 / D4 polish).
//
// The marketing landing's "See what RepoBaron found" row needs more
// than just the WorkspaceSummary — visitors look at the cards to
// gauge the *scale* of analysis too (star count, files, functions,
// hotspots). This helper does a single session-load and emits both
// the summary + a small stats object so the card can render rich
// metadata without extra round-trips.
//
// Cheap: one JSON parse per demo session, four demo sessions →
// four parses. Runs in parallel via Promise.all from app/page.tsx.

import { extractHealthSignals } from "../signals";
import { pickHeadline } from "./headline";
import { summarizeHealth } from "./healthSummary";
import { getSession } from "../storage";
import type { WorkspaceSummary } from "./workspaceTypes";

/** Compact top-hotspot record — function name + file path +
 *  complexity score. Surfaced in the featured demo hero's right-side
 *  "findings panel" so visitors see concrete, code-form output
 *  rather than abstract marketing copy. */
export interface DemoHotspotEntry {
  name: string;
  path: string;
  complexity: number;
}

export interface DemoCard {
  summary: WorkspaceSummary;
  stats: {
    /** GitHub star count at the time of the latest snapshot. */
    stars: number;
    /** Total file count across every plugin's parsed files. Zero
     *  when no codeGraph (analysis was skipped / unsupported). */
    files: number;
    /** Total function/method count discovered. Zero when no codeGraph. */
    functions: number;
    /** Files identified as "hotspots" by the churn × complexity
     *  scorer. Zero when no hotspots field on snapshot. */
    hotspots: number;
    /** Highest cyclomatic complexity found in any function. Null
     *  when no codeGraph (signals callers to omit the stat). */
    maxComplexity: number | null;
    /** Top hotspots by cyclomatic complexity, filtered to cx ≥ 10
     *  so we don't surface trivial functions. Capped at 6 so the
     *  findings panel has a predictable height. Sorted desc. */
    topHotspots: DemoHotspotEntry[];
    /** Total count of functions above the cx-10 threshold. Drives
     *  the "+ N more above cx 10" footnote in the panel. */
    totalHighComplexity: number;
  };
}

export async function getDemoCard(
  sessionId: string,
): Promise<DemoCard | null> {
  const session = await getSession(sessionId);
  if (!session) return null;
  const latest = session.snapshots[session.snapshots.length - 1];
  if (!latest) return null;

  // Build the same WorkspaceSummary the workspace dashboard uses, so
  // headline + dimensions + criticalCount are consistent across
  // surfaces.
  const dimensions = summarizeHealth(latest);
  const headline = pickHeadline(latest);
  const signals = extractHealthSignals(latest);
  const criticalCount = signals.needsWork.filter(
    (s) => s.severity === "high",
  ).length;
  const summary: WorkspaceSummary = {
    id: session.id,
    name: session.name,
    repoFullName: latest.repo.fullName,
    updatedAt: session.updatedAt,
    snapshotCount: session.snapshots.length,
    dimensions,
    headline,
    criticalCount,
  };

  // Derive scale stats from codeGraph if present.
  const cg = latest.codeGraph;
  const files = cg
    ? Object.values(cg.filesByExt).reduce((a, b) => a + b, 0)
    : 0;
  const functions = cg?.functions.length ?? 0;
  const maxComplexity = cg
    ? cg.functions.reduce(
        (max, f) => Math.max(max, f.complexity ?? 0),
        0,
      )
    : null;

  // Top hotspots — high-complexity functions for the featured-demo
  // hero panel. Filter to cx ≥ 10 so we don't show trivial functions
  // on small repos; sort desc; cap at 6 for predictable layout.
  const highComplexity = cg
    ? cg.functions.filter((f) => (f.complexity ?? 0) >= 10)
    : [];
  const topHotspots: DemoHotspotEntry[] = [...highComplexity]
    .sort((a, b) => (b.complexity ?? 0) - (a.complexity ?? 0))
    .slice(0, 6)
    .map((f) => ({
      name: f.name,
      path: f.filePath,
      complexity: f.complexity ?? 0,
    }));

  return {
    summary,
    stats: {
      stars: latest.repo.stars,
      files,
      functions,
      hotspots: latest.hotspots?.length ?? 0,
      maxComplexity,
      topHotspots,
      totalHighComplexity: highComplexity.length,
    },
  };
}
