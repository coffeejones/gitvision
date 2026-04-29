// POST /api/sessions/[id]/refresh — enqueue a refresh job that re-runs
// the full analysis pipeline and appends a new snapshot. Returns
// { jobId } immediately; the client polls /api/jobs/<id> until done
// and then reloads the session page. (v0.25+)

import { NextResponse } from "next/server";
import { after } from "next/server";
import { parseRepoUrl } from "@/lib/github";
import { createJob, processJob } from "@/lib/jobs";
import { OWNER_ID_HEADER } from "@/lib/ownerId";
import {
  RATE_LIMITS,
  checkRateLimit,
  getClientIp,
} from "@/lib/rateLimit";
import { getSession } from "@/lib/storage";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, ctx: Ctx) {
  const ip = getClientIp(req);
  const rl = checkRateLimit(`refresh:${ip}`, RATE_LIMITS.sessionRefresh);
  if (!rl.ok) {
    const retryAfterSec = Math.ceil((rl.resetAt - Date.now()) / 1000);
    return NextResponse.json(
      {
        error: `Rate limit reached. Try again in ${Math.ceil(
          retryAfterSec / 60
        )} minutes.`,
      },
      {
        status: 429,
        headers: {
          "Retry-After": String(retryAfterSec),
          "X-RateLimit-Reset": String(rl.resetAt),
        },
      }
    );
  }

  const { id } = await ctx.params;
  const session = await getSession(id);
  if (!session) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Refresh creates a new snapshot — that's a mutation. Enforce
  // ownership unless the session is legacy (no ownerId).
  if (session.ownerId) {
    const callerOwnerId = req.headers.get(OWNER_ID_HEADER);
    if (callerOwnerId !== session.ownerId) {
      return NextResponse.json(
        {
          error:
            "This session belongs to a different browser. Open the original tab to refresh it, or create a new analysis.",
        },
        { status: 403 }
      );
    }
  }

  const parsed = parseRepoUrl(session.repoUrl);
  if (!parsed) {
    return NextResponse.json({ error: "Stored repoUrl is invalid" }, { status: 400 });
  }

  // Refresh re-uses the same scope as the most recent snapshot. Subdir is
  // a per-session decision (set at create time); refresh shouldn't silently
  // change scope and start showing different signals.
  const prev = session.snapshots[session.snapshots.length - 1];
  const subdir = prev?.analyzedSubdir ?? null;

  const job = await createJob({
    kind: "refresh-session",
    sessionId: id,
    repoUrl: session.repoUrl,
    subdir,
  });
  after(() => processJob(job.id));
  return NextResponse.json({ jobId: job.id });
}
