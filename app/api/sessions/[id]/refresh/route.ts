// POST /api/sessions/[id]/refresh — enqueue a refresh job that re-runs
// the full analysis pipeline and appends a new snapshot. Returns
// { jobId } immediately; the client polls /api/jobs/<id> until done
// and then reloads the session page. (v0.25+)

import { NextResponse } from "next/server";
import { after } from "next/server";
import { headers as nextHeaders } from "next/headers";
import { auth } from "@/lib/auth";
import { checkAndIncrementRefresh } from "@/lib/billing/refreshQuota";
import { parseRepoUrl } from "@/lib/github";
import { createJob, processJob } from "@/lib/jobs";
import { requireSessionOwnership } from "@/lib/ownership";
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

  // Refresh creates a new snapshot — that's a mutation. Use the shared
  // ownership helper so we honour both the userId (account) and ownerId
  // (cookie) claims uniformly with the other mutating routes. Replaces
  // an earlier inline ownerId-only check that would refuse refreshes
  // from the legitimate account owner on user-owned sessions (v0.76+).
  const denied = await requireSessionOwnership(session, req);
  if (denied) return denied;

  // Tier gate: Scout users get 5 refreshes per day. Knight + Baron are
  // unlimited (the helper still updates the counter for observability
  // but doesn't reject). We check + increment AFTER ownership has been
  // verified — wouldn't want a rate-limited "you're not the owner"
  // error to consume one of the user's daily refreshes.
  const authSession = await auth.api.getSession({
    headers: await nextHeaders(),
  });
  if (authSession?.user) {
    const quota = await checkAndIncrementRefresh(authSession.user.id);
    if (!quota.allowed) {
      return NextResponse.json(
        {
          error: quota.reason ?? "Daily refresh limit reached",
          quota: { used: quota.used, max: quota.max },
        },
        { status: 429 },
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
