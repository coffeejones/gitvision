// POST /api/sessions/[id]/refresh — enqueue a refresh job that re-runs
// the full analysis pipeline and appends a new snapshot. Returns
// { jobId } immediately; the client polls /api/jobs/<id> until done
// and then reloads the session page. (v0.25+)

import { NextResponse } from "next/server";
import { after } from "next/server";
import { parseRepoUrl } from "@/lib/github";
import { createJob, processJob } from "@/lib/jobs";
import { getSession } from "@/lib/storage";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const session = await getSession(id);
  if (!session) return NextResponse.json({ error: "Not found" }, { status: 404 });

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
