// Browser-safe types + pure helpers for the workspace dashboard
// (v0.69 / C3 polish).
//
// Split out of workspaceSummary.ts so client components (AdaptiveHome)
// can import the types + the pure sort function without dragging
// node:fs / lib/storage into the browser bundle. The fetch-from-disk
// helpers (getWorkspaceSummary, getWorkspaceSummaries) stay in
// workspaceSummary.ts and are server-only.

import type { Headline } from "./headline";
import { cmpStr } from "../deterministicSort";
import type {
  DimensionStatus,
  DimensionSummary,
} from "./healthSummary";

export interface WorkspaceSummary {
  /** Session id — clicking the workspace card navigates to /session/{id}. */
  id: string;
  /** User-editable display name. Falls back to repo full name on
   *  legacy sessions without a custom name. */
  name: string;
  /** owner/repo slug of the analyzed repo. */
  repoFullName: string;
  /** ISO timestamp of the latest session activity (refresh, name
   *  edit, etc.). Drives "X hours ago" display + sort order. */
  updatedAt: string;
  /** How many snapshots this session has. ≥3 enables trend rendering;
   *  =1 means it's never been refreshed. */
  snapshotCount: number;
  /** Six-dimension health summary computed from the latest snapshot. */
  dimensions: DimensionSummary[];
  /** Top finding picked by the headline waterfall. */
  headline: Headline;
  /** Count of high-severity needsWork signals. Drives sort order
   *  ("most-critical first") + the prioritization chip on each card. */
  criticalCount: number;
}

/** Sort summaries by "most-needs-attention first": critical signals
 *  desc, then warning-tier dimensions, then by updatedAt desc as a
 *  stable tiebreaker. The result is "what should I look at first"
 *  ordering, not "what changed most recently" — that's the
 *  difference between a workspace dashboard and a sessions list. */
export function sortWorkspaceByPriority(
  summaries: WorkspaceSummary[]
): WorkspaceSummary[] {
  return [...summaries].sort((a, b) => {
    if (b.criticalCount !== a.criticalCount) {
      return b.criticalCount - a.criticalCount;
    }
    const aWarn = countStatus(a.dimensions, "warning");
    const bWarn = countStatus(b.dimensions, "warning");
    if (bWarn !== aWarn) return bWarn - aWarn;
    return cmpStr(b.updatedAt, a.updatedAt);
  });
}

function countStatus(
  dimensions: DimensionSummary[],
  status: DimensionStatus
): number {
  return dimensions.filter((d) => d.status === status).length;
}
