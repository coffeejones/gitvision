// POST /api/preview — enqueue a change-blast preview job for a PR. Returns
// { jobId } immediately; the client polls /api/jobs/<id> until it carries a
// previewId, then fetches /api/previews/<id>. Same login gate + rate limit as
// session creation (each preview runs two full analyses). (Arc 5)

import { NextResponse, after } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { parsePrUrl } from "@/lib/github";
import { createJob, processJob } from "@/lib/jobs";
import { RATE_LIMITS, checkRateLimit, getClientIp } from "@/lib/rateLimit";

const Schema = z.object({ prUrl: z.string().min(1) });

export async function POST(req: Request) {
  const ip = getClientIp(req);
  const rl = checkRateLimit(`preview:${ip}`, RATE_LIMITS.sessionCreate);
  if (!rl.ok) {
    const retryAfterSec = Math.ceil((rl.resetAt - Date.now()) / 1000);
    return NextResponse.json(
      { error: `Rate limit reached. Try again in ${Math.ceil(retryAfterSec / 60)} minutes.` },
      {
        status: 429,
        headers: {
          "Retry-After": String(retryAfterSec),
          "X-RateLimit-Reset": String(rl.resetAt),
        },
      },
    );
  }

  const authSession = await auth.api.getSession({ headers: req.headers });
  if (!authSession) {
    return NextResponse.json(
      { error: "Sign in to preview a pull request." },
      { status: 401 },
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const pr = parsePrUrl(parsed.data.prUrl);
  if (!pr) {
    return NextResponse.json(
      {
        error:
          "Could not parse a GitHub pull-request URL. Expected e.g. https://github.com/owner/repo/pull/123",
      },
      { status: 400 },
    );
  }

  const job = await createJob({
    kind: "preview-blast",
    owner: pr.owner,
    repo: pr.repo,
    number: pr.number,
    userId: authSession.user.id,
  });
  after(() => processJob(job.id));
  return NextResponse.json({ jobId: job.id });
}
