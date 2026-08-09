// GET /api/sessions/[id]/drift — the multi-sweep drift report for the share card.
//
// This used to be computed in app/session/[id]/layout.tsx, which meant every one
// of the seventeen session tabs paid for it on every navigation. Its only
// consumer is DriftCardModal, whose `open` starts false and is set true by a
// single menu item — so the work was being done eagerly for a dialog most
// visitors never open.
//
// The cost is not the JSON: computeDriftTrends compares the OLDEST and NEWEST
// measurable snapshots, and when a snapshot has no persisted driftMetrics
// fingerprint it derives one by walking that snapshot's whole code graph
// (allDuplicateGroups + computeTestCoverage). 55 of the 57 snapshots on disk
// lack the fingerprint, so the fallback was the normal path, not the exception.
// Measured per page load: 2.1 ms on gin, 7.9 ms on zod, 8.5 ms on our own repo.
//
// Moving it here also frees the session layout of any dependency on
// snapshots[0] — it now only ever needs the latest one. That was the real
// blocker for splitting the session file, worth more than the milliseconds.
//
// READ access, not ownership: the drift card is a share artifact, and public
// demo sessions are meant to be viewable logged-out. Same gate the layout used,
// via the request-flavoured variant that route handlers take.

import { NextResponse } from "next/server";

import { requireSessionReadAccessFromRequest } from "@/lib/ownership";
import { getSession } from "@/lib/storage";
import { computeDriftTrends } from "@/lib/driftMetrics";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;

  const session = await getSession(id);
  // A missing session answers exactly as a forbidden one does, so this cannot
  // be used to test whether a private analysis exists — the hole the badge
  // endpoint had. requireSessionReadAccessFromRequest returns the same 404.
  if (!session) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const denied = await requireSessionReadAccessFromRequest(session, req);
  if (denied) return denied;

  return NextResponse.json(computeDriftTrends(session.snapshots));
}
