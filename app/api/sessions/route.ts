// POST /api/sessions  — enqueue a new session-create job. Returns
//                       { jobId } immediately; the client polls
//                       /api/jobs/<id> until done. (v0.25+)
// GET  /api/sessions  — list all sessions

import { NextResponse } from "next/server";
import { after } from "next/server";
import { z } from "zod";
import { parseRepoUrl } from "@/lib/github";
import { validateSubdir } from "@/lib/graph";
import { createJob, processJob } from "@/lib/jobs";
import { listSessions } from "@/lib/storage";

const CreateSchema = z.object({
  repoUrl: z.string().min(1),
  name: z.string().optional(),
  /** Optional subdir to scope the analysis to (v0.24+). Validated server-
   *  side via validateSubdir — invalid values produce a 400. Empty
   *  strings are treated as "no subdir". */
  subdir: z.string().optional(),
});

export async function GET() {
  const sessions = await listSessions();
  return NextResponse.json({ sessions });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  // Cheap synchronous validation we can do without spinning up an analysis.
  // Anything that requires hitting GitHub (does the repo exist? does the
  // subdir exist?) is deferred to the background job — it surfaces in
  // the polled status as a "failed" outcome.
  const parsedRepo = parseRepoUrl(parsed.data.repoUrl);
  if (!parsedRepo) {
    return NextResponse.json(
      { error: "Could not parse GitHub URL. Expected e.g. https://github.com/owner/repo" },
      { status: 400 }
    );
  }
  let subdir: string | null;
  try {
    subdir = validateSubdir(parsed.data.subdir);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Invalid subdir" },
      { status: 400 }
    );
  }

  // Enqueue the job. processJob runs detached via after() — the HTTP
  // request returns in <1s regardless of how long the actual analysis
  // takes. This is what unlocks repos like golang/go on Railway.
  const job = await createJob({
    kind: "create-session",
    repoUrl: parsed.data.repoUrl,
    sessionName: parsed.data.name,
    subdir,
  });
  after(() => processJob(job.id));
  return NextResponse.json({ jobId: job.id });
}
