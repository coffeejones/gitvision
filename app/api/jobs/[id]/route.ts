// GET /api/jobs/[id] — polled by the client while a long-running analysis
// is in flight. Returns the current Job record verbatim. The client moves
// on (redirect to session, or surface error) when status flips to
// "done" or "failed".
//
// Safe to call repeatedly — reads are atomic (writes go through
// temp+rename in lib/jobs.ts), so we never see a half-written file.

import { NextResponse } from "next/server";
import { getJob } from "@/lib/jobs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const job = await getJob(id);
  if (!job) {
    return NextResponse.json(
      {
        error:
          "Job not found. It may have been cleaned up after completion, or never existed.",
      },
      { status: 404 }
    );
  }
  return NextResponse.json({ job });
}
