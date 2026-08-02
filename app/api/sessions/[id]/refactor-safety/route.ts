// GET /api/sessions/[id]/refactor-safety — the load-bearing-walls report.
//
// WallCardModal used to compute this in the browser from snapshot.codeGraph.
// That is the only reason the graph was on the client prop at all, and it cost
// every visitor the whole graph — 5.59 MB of the zod session's 6.34 MB — on
// every tab in the workspace, to serve a dialog that starts closed and that
// most visits never open.
//
// The modal already deferred the COMPUTE to first open (a useMemo gated on
// `open`), which was the right instinct; the data still travelled eagerly.
// Fetching here defers both, and the report itself is small — counts plus a
// bounded file list — so the roundtrip carries kilobytes, not megabytes.
//
// READ access, not ownership: the wall card is a share artifact and public demo
// sessions are meant to be viewable logged-out. Same gate, and the same
// deliberate 404-for-both as the drift route — a missing session and a
// forbidden one must be indistinguishable, or this becomes a way to test
// whether a private analysis exists.

import { NextResponse } from "next/server";

import { requireSessionReadAccessFromRequest } from "@/lib/ownership";
import { getSession } from "@/lib/storage";
import { computeRefactorSafety } from "@/lib/refactorSafety";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;

  const session = await getSession(id);
  if (!session) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const denied = await requireSessionReadAccessFromRequest(session, req);
  if (denied) return denied;

  // Indexed defensively for the same reason isSessionPrivate is: a partial
  // write leaves a session with no snapshots array at all.
  const snapshots = session.snapshots ?? [];
  const current = snapshots[snapshots.length - 1];
  // No graph is not an error — a snapshot analyzed before the code-analysis
  // pipeline, or one whose languages have no plugin, simply has no walls to
  // report. The modal renders its own empty state on a null report.
  if (!current?.codeGraph) {
    return NextResponse.json({ report: null });
  }

  return NextResponse.json({ report: computeRefactorSafety(current.codeGraph) });
}
