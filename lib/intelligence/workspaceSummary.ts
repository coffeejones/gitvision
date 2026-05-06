// Per-session rich summary for the workspace dashboard (v0.68 / C3).
//
// Bridges raw Session JSON files on disk to the workspace UI. Each
// summary carries enough information for a one-row card: identity
// (repo, name, snapshot count, last-refresh), the six dimension
// statuses (so the workspace can render a mini-strip of tiles
// without the user opening the session), the headline finding, and
// a critical-issue count for quick prioritization.
//
// Pure server-side composition over existing intelligence layers —
// summarizeHealth + pickHeadline + extractHealthSignals. No new
// computation, just packaging.

import { extractHealthSignals } from "../signals";
import { pickHeadline, type Headline } from "./headline";
import {
  summarizeHealth,
  type DimensionStatus,
  type DimensionSummary,
} from "./healthSummary";
import { getSession } from "../storage";

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
   *  =1 means it's never been refreshed (most alpha-launch sessions
   *  fall here). */
  snapshotCount: number;
  /** Six-dimension health summary computed from the latest snapshot.
   *  Fixed canonical order (Activity, Team, Code, PR flow, Deps,
   *  Hygiene). Workspace cards render these as a mini-strip. */
  dimensions: DimensionSummary[];
  /** Top finding picked by the headline waterfall. Workspace cards
   *  surface its severity + primary text so the user sees "what
   *  matters here" without opening the session. */
  headline: Headline;
  /** Count of high-severity needsWork signals across all dimensions
   *  on the latest snapshot. Drives sort order ("most-critical
   *  first") and the prioritization chip on each card. */
  criticalCount: number;
}

/** Read one session from disk and project it to a WorkspaceSummary.
 *  Returns null when the session doesn't exist or the latest snapshot
 *  is missing — both conditions imply we have nothing meaningful to
 *  display on the dashboard. */
export async function getWorkspaceSummary(
  sessionId: string
): Promise<WorkspaceSummary | null> {
  const session = await getSession(sessionId);
  if (!session) return null;
  const latest = session.snapshots[session.snapshots.length - 1];
  if (!latest) return null;

  const dimensions = summarizeHealth(latest);
  const headline = pickHeadline(latest);
  const signals = extractHealthSignals(latest);
  const criticalCount = signals.needsWork.filter(
    (s) => s.severity === "high"
  ).length;

  return {
    id: session.id,
    name: session.name,
    repoFullName: latest.repo.fullName,
    updatedAt: session.updatedAt,
    snapshotCount: session.snapshots.length,
    dimensions,
    headline,
    criticalCount,
  };
}

/** Project a list of session ids in parallel. Failures on individual
 *  sessions are filtered out — a single corrupt session.json shouldn't
 *  blank the whole workspace. */
export async function getWorkspaceSummaries(
  sessionIds: string[]
): Promise<WorkspaceSummary[]> {
  const results = await Promise.all(
    sessionIds.map((id) =>
      getWorkspaceSummary(id).catch(() => null)
    )
  );
  return results.filter((s): s is WorkspaceSummary => s !== null);
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
    return b.updatedAt.localeCompare(a.updatedAt);
  });
}

function countStatus(
  dimensions: DimensionSummary[],
  status: DimensionStatus
): number {
  return dimensions.filter((d) => d.status === status).length;
}
