// GET /api/jobs/[id] — polled by the client while a long-running analysis
// is in flight. Returns the current Job record verbatim to the requester
// who owns it. The client moves on (redirect to session, or surface error)
// when status flips to "done" or "failed".
//
// Safe to call repeatedly — reads are atomic (writes go through
// temp+rename in lib/jobs.ts), so we never see a half-written file.
//
// Ownership gate: the Job record carries the analyzed repo URL + internal
// ids, so it's owner-scoped, not public. Session creation requires auth, so
// a create-job always has a userId and the authed poller (same browser,
// cookies sent) resolves to it. A refresh-job derives its owner from the
// target session. Non-owners get a 404 — same disclosure model as the
// session read gate (don't reveal that the job exists).

import { NextResponse } from "next/server";
import { getJob } from "@/lib/jobs";
import { getSession } from "@/lib/storage";
import { auth } from "@/lib/auth";
import { checkSessionOwnership } from "@/lib/ownership";
import { OWNER_ID_HEADER } from "@/lib/ownerId";
import type { Job } from "@/lib/types";

type Ctx = { params: Promise<{ id: string }> };

const NOT_FOUND = {
  error:
    "Job not found. It may have been cleaned up after completion, or never existed.",
};

export async function GET(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const job = await getJob(id);
  if (!job) {
    return NextResponse.json(NOT_FOUND, { status: 404 });
  }

  // Resolve the owning claim for this job, then require the caller to match.
  const owner = await ownerClaimForJob(job);
  if (owner.userId || owner.ownerId) {
    const callerUserId = owner.userId
      ? ((await auth.api.getSession({ headers: req.headers }))?.user.id ?? null)
      : null;
    const callerOwnerId = req.headers.get(OWNER_ID_HEADER);
    const decision = checkSessionOwnership(owner, callerUserId, callerOwnerId);
    if (decision !== "allowed") {
      // 404 (not 403) so a leaked job id doesn't confirm the job exists.
      return NextResponse.json(NOT_FOUND, { status: 404 });
    }
  }

  return NextResponse.json({ job });
}

/** Ownership claim for a job. Create-jobs carry the claim on the input
 *  directly; refresh-jobs inherit it from the session they target.
 *  Returns an empty object for ownerless legacy jobs (left open). */
async function ownerClaimForJob(
  job: Job,
): Promise<{ userId?: string; ownerId?: string }> {
  if (job.input.kind === "create-session") {
    return { userId: job.input.userId, ownerId: job.input.ownerId };
  }
  const session = await getSession(job.input.sessionId);
  if (!session) return {};
  return { userId: session.userId, ownerId: session.ownerId };
}
