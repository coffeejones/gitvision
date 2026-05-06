// POST /api/sessions  — enqueue a new session-create job. Returns
//                       { jobId } immediately; the client polls
//                       /api/jobs/<id> until done. (v0.25+)
// GET  /api/sessions  — list all sessions

import { NextResponse } from "next/server";
import { after } from "next/server";
import { z } from "zod";
import { extractOrgOrUserFromUrl, parseRepoUrl } from "@/lib/github";
import { validateSubdir } from "@/lib/graph";
import { createJob, processJob } from "@/lib/jobs";
import { OWNER_ID_HEADER } from "@/lib/ownerId";
import {
  RATE_LIMITS,
  checkRateLimit,
  getClientIp,
} from "@/lib/rateLimit";
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
  // Rate limit BEFORE input parsing — even malformed payloads cost us
  // CPU + bandwidth, and rejecting a bot loop quickly matters.
  const ip = getClientIp(req);
  const rl = checkRateLimit(`sessions:${ip}`, RATE_LIMITS.sessionCreate);
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
    // Detect the common case where a user pasted a GitHub organization
    // or user-profile URL (https://github.com/ZeebleChat) instead of a
    // specific repo URL. Generic parse-error doesn't help them; this
    // tells them what to do next.
    const orgOrUser = extractOrgOrUserFromUrl(parsed.data.repoUrl);
    if (orgOrUser) {
      return NextResponse.json(
        {
          error: `That looks like a GitHub organization or user URL (${orgOrUser}), not a specific repository. GitVision analyzes one repo at a time — pick a repo from https://github.com/${orgOrUser}?tab=repositories and paste its URL.`,
        },
        { status: 400 }
      );
    }
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

  // Read the anonymous owner-id from the X-Owner-Id header (v0.26+).
  // The client populates this from localStorage; absent header means an
  // older client or a direct curl call — we accept it and the resulting
  // session has no owner (legacy treatment, visible to anyone).
  const ownerId = req.headers.get(OWNER_ID_HEADER) ?? undefined;

  // Enqueue the job. processJob runs detached via after() — the HTTP
  // request returns in <1s regardless of how long the actual analysis
  // takes. This is what unlocks repos like golang/go on Railway.
  const job = await createJob({
    kind: "create-session",
    repoUrl: parsed.data.repoUrl,
    sessionName: parsed.data.name,
    subdir,
    ownerId,
  });
  after(() => processJob(job.id));
  return NextResponse.json({ jobId: job.id });
}
