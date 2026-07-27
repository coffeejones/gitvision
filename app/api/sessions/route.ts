// POST /api/sessions  — enqueue a new session-create job. Returns
//                       { jobId } immediately; the client polls
//                       /api/jobs/<id> until done. (v0.25+)
// GET  /api/sessions  — list the CALLER'S OWN sessions. Sign-in required.

import { NextResponse } from "next/server";
import { after } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { getUserTier } from "@/lib/billing/gates";
import { TIER_CONFIG } from "@/lib/pricing";
import { extractOrgOrUserFromUrl, parseRepoUrl } from "@/lib/github";
import { isSafeGitRef } from "@/lib/githubUrl";
import { validateSubdir } from "@/lib/graph";
import { createJob, processJob } from "@/lib/jobs";
import { filterSessionsByUser, OWNER_ID_HEADER } from "@/lib/ownerId";
import {
  RATE_LIMITS,
  checkRateLimit,
  getClientIp,
} from "@/lib/rateLimit";
import { deleteSession, listSessions } from "@/lib/storage";

const CreateSchema = z.object({
  repoUrl: z.string().min(1),
  name: z.string().optional(),
  /** Optional subdir to scope the analysis to (v0.24+). Validated server-
   *  side via validateSubdir — invalid values produce a 400. Empty
   *  strings are treated as "no subdir". */
  subdir: z.string().optional(),
  /** Optional git ref (branch/tag/SHA) chosen in the pre-analysis config.
   *  Absent/empty → the repo's default branch. Charset-validated below via
   *  isSafeGitRef. */
  ref: z.string().optional(),
});

/** The listing shape. Deliberately NOT SessionSummary: that carries `userId`
 *  and `ownerId`, which are internal identifiers the caller has no use for and
 *  which linked an analysis to the account that ran it. */
function toListing(s: {
  id: string;
  name: string;
  repoUrl: string;
  repoFullName: string;
  createdAt: string;
  updatedAt: string;
  snapshotCount: number;
  private?: boolean;
}) {
  return {
    id: s.id,
    name: s.name,
    repoUrl: s.repoUrl,
    repoFullName: s.repoFullName,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    snapshotCount: s.snapshotCount,
    private: s.private,
  };
}

/** List the caller's own analyses.
 *
 *  This used to return every non-private session on the instance to anyone,
 *  unauthenticated, with `userId` attached — so a stranger could enumerate
 *  which repositories every account had analyzed and when. The intent behind
 *  it was the "anyone with the URL can view a public analysis" rule, but a
 *  shareable link and a full directory are different promises, and only the
 *  first was ever made. Nothing in the app consumed this: `/cases` calls
 *  `listSessions()` server-side and filters with `filterSessionsByUser`, and
 *  the three client fetches of /api/sessions are all POST.
 *
 *  Sharing is untouched — a public analysis is still readable by anyone
 *  holding its id (app/api/sessions/[id]). What is gone is the way to obtain
 *  ids you were never given. */
export async function GET(req: Request) {
  const authSession = await auth.api.getSession({ headers: req.headers });
  const userId = authSession?.user.id ?? null;
  if (!userId) {
    return NextResponse.json(
      { error: "Sign in to list your analyses." },
      { status: 401 },
    );
  }

  const sessions = await listSessions();
  // Same helper /cases uses, so the two listings cannot drift apart: it drops
  // demo-owned sessions and returns [] for a null user.
  const owned = filterSessionsByUser(sessions, userId);
  return NextResponse.json({ sessions: owned.map(toListing) });
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

  // Auth gate (v0.76+): session creation is logged-in only. Anonymous
  // visitors see the marketing landing with demo sessions; they need
  // to sign up before analyzing their own repos. This is the single
  // most important rule in the post-platform-pivot model — without
  // it, sessions accumulate without ownership and pile up on disk.
  //
  // We check auth BEFORE input parsing so a malformed payload from a
  // logged-out caller still returns 401 (the actionable error) rather
  // than 400 ("fix your JSON") which would mask the real problem.
  const authSession = await auth.api.getSession({ headers: req.headers });
  if (!authSession) {
    return NextResponse.json(
      { error: "Sign in to analyze repositories." },
      { status: 401 }
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
          error: `That looks like a GitHub organization or user URL (${orgOrUser}), not a specific repository. CodeTrawl analyzes one repo at a time — pick a repo from https://github.com/${orgOrUser}?tab=repositories and paste its URL.`,
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

  // Optional branch/ref chosen in the pre-analysis config. Empty → null
  // (analyze the default branch, same as before). Charset-validate so the
  // value can't reach `git log <ref>` as a flag or a malformed ref. (This is
  // also the natural seam for a future Plus-only branch gate.)
  const refRaw = parsed.data.ref?.trim();
  const ref = refRaw ? refRaw : null;
  if (ref && !isSafeGitRef(ref)) {
    return NextResponse.json(
      { error: "Invalid branch name." },
      { status: 400 }
    );
  }

  // Optional cookie ownerId — kept on new sessions as a historical
  // breadcrumb (which browser created this) but no longer used for
  // ownership decisions. authSession.user.id is the only thing the
  // workspace listing and authorization checks look at.
  const ownerId = req.headers.get(OWNER_ID_HEADER) ?? undefined;
  const userId = authSession.user.id;

  // Tier gate: Free users get 1 saved session at a time. When they
  // create a new one, auto-delete their oldest existing session
  // (matches the "1 session at a time" wording on /pricing — it's
  // not "you can't make new ones", it's "the new one replaces the
  // old one"). Plus + Pro have unlimited saved sessions.
  const userTier = await getUserTier(userId);
  const savedSessionsCap = TIER_CONFIG[userTier].limits.savedSessions;
  if (savedSessionsCap !== -1) {
    const allSessions = await listSessions();
    const userSessions = filterSessionsByUser(allSessions, userId);
    if (userSessions.length >= savedSessionsCap) {
      // Delete oldest first to bring count below the cap. Sort by
      // updatedAt ascending → oldest first. We delete one at a time
      // to keep the operation idempotent if it partially fails.
      const sorted = [...userSessions].sort((a, b) =>
        a.updatedAt.localeCompare(b.updatedAt),
      );
      const toDelete = sorted.slice(
        0,
        userSessions.length - savedSessionsCap + 1,
      );
      for (const s of toDelete) {
        await deleteSession(s.id);
      }
    }
  }

  // Enqueue the job. processJob runs detached via after() — the HTTP
  // request returns in <1s regardless of how long the actual analysis
  // takes. This is what unlocks repos like golang/go on Railway.
  const job = await createJob({
    kind: "create-session",
    repoUrl: parsed.data.repoUrl,
    sessionName: parsed.data.name,
    subdir,
    ref,
    ownerId,
    userId,
  });
  after(() => processJob(job.id));
  return NextResponse.json({ jobId: job.id });
}
