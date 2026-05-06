// Per-session rich summary for the workspace dashboard (v0.68 / C3,
// split v0.69 to keep server-only code out of the browser bundle).
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
// computation, just packaging. Calls into lib/storage which uses
// node:fs, so this module is server-only; client code that just
// wants the WorkspaceSummary type or the sort helper should import
// from workspaceTypes.ts instead.

import { extractHealthSignals } from "../signals";
import { pickHeadline } from "./headline";
import { summarizeHealth } from "./healthSummary";
import { getSession } from "../storage";
import type { WorkspaceSummary } from "./workspaceTypes";

// Re-export the types + sort helper so server code can import
// everything from the same module.
export {
  sortWorkspaceByPriority,
  type WorkspaceSummary,
} from "./workspaceTypes";

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
