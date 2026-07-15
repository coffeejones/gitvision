// GET /api/sessions/[id]/source?path=<relpath> — live source for the read-only
// Source view.
//
// Fetches ONE analyzed file's contents from GitHub, pinned to the exact commit
// we analyzed (`analyzedRef`), so the deterministic annotations (function spans,
// hotspots) line up with the lines shown. The source is NEVER persisted —
// fetched on demand and streamed to the client — which keeps the "we keep the
// findings, never your files" promise and spares the volume any growth.
//
// Gate stack (in order): per-IP rate limit → session exists → read access
// (private-repo sessions owner-only, 404 not 403) → free-phase entitlement
// (signed-in OR a demo session; the view is free but an account gates the token
// budget) → path is a real analyzed file (bounds the fetch, blocks traversal) →
// fetch, pinned to analyzedRef. Integrity is proven by djb2, not trusted.

import { NextResponse } from "next/server";
import { getSession } from "@/lib/storage";
import { requireSessionReadAccess } from "@/lib/ownership";
import { getAuthSession } from "@/lib/authSession";
import { isDemoSession } from "@/lib/demoSessions";
import { getClientIp, checkRateLimit, RATE_LIMITS } from "@/lib/rateLimit";
import { isSafeRelPath } from "@/lib/shadowGraph/validateChanges";
import { getGithubTokenForUser } from "@/lib/githubUserToken";
import { makeOctokit } from "@/lib/github";
import {
  fetchFileSource,
  isAligned,
  type SourceOctokit,
  type FetchSourceError,
} from "@/lib/sourceView";
import { functionMarkersFor } from "@/lib/sourceAnnotations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const ERROR_STATUS: Record<FetchSourceError, number> = {
  "not-a-file": 400,
  "too-large": 413,
  "not-found": 404,
  forbidden: 502,
};

const ERROR_MESSAGE: Record<FetchSourceError, string> = {
  "not-a-file": "That path isn't a file.",
  "too-large": "This file is too large to display.",
  "not-found":
    "File not found at the analyzed commit — it may have been removed or the history rewritten. Refresh the session to re-analyze.",
  forbidden:
    "GitHub declined the request (rate limit or access). Try again shortly.",
};

export async function GET(req: Request, ctx: Ctx) {
  // 1. Rate limit — one live GitHub call per open; bound the per-IP burst.
  const ip = getClientIp(req);
  const rl = checkRateLimit(`source:${ip}`, RATE_LIMITS.sourceView);
  if (!rl.ok) {
    const retryAfterSec = Math.ceil((rl.resetAt - Date.now()) / 1000);
    return NextResponse.json(
      { error: `Rate limit reached. Try again in ${Math.ceil(retryAfterSec / 60)} minutes.` },
      { status: 429, headers: { "Retry-After": String(retryAfterSec) } },
    );
  }

  // 2. Session must exist.
  const { id } = await ctx.params;
  const session = await getSession(id);
  if (!session) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // 3. Read access — private-repo sessions are owner-only. 404 (not 403) so we
  //    don't confirm a private session exists to a stranger.
  if (!(await requireSessionReadAccess(session))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // 4. Free-phase entitlement: the Source view is free, but an account gates the
  //    GitHub token budget against anonymous abuse. Demo sessions bypass so the
  //    public showcase needs no login.
  const isDemo = isDemoSession(id);
  const authSession = await getAuthSession();
  if (!isDemo && !authSession) {
    return NextResponse.json(
      { error: "Sign in to view source — it's free.", signIn: true },
      { status: 401 },
    );
  }

  const snap = session.snapshots[session.snapshots.length - 1];
  const cg = snap?.codeGraph;
  if (!snap || !cg?.contentHashes) {
    return NextResponse.json(
      { error: "This snapshot has no analyzed files. Refresh to re-analyze." },
      { status: 404 },
    );
  }
  const hashes = cg.contentHashes;

  // 5. Path must be a real analyzed file. This bounds the fetch to files we
  //    actually parsed (no arbitrary GitHub path) AND blocks traversal.
  const path = new URL(req.url).searchParams.get("path") ?? "";
  if (!isSafeRelPath(path)) {
    return NextResponse.json({ error: "Invalid path." }, { status: 400 });
  }
  const expectedHash = hashes[path];
  if (expectedHash === undefined) {
    return NextResponse.json(
      { error: "Not an analyzed file in this snapshot." },
      { status: 404 },
    );
  }

  // 6. Token: the owner's for a private repo (read access already proved the
  //    viewer is the owner), the shared server token for a public repo.
  const repoPrivate = snap.repo.private === true;
  let token: string | null | undefined = process.env.GITHUB_TOKEN;
  if (repoPrivate && authSession) {
    token = await getGithubTokenForUser(authSession.user.id);
    if (!token) {
      return NextResponse.json(
        { error: "Reconnect your GitHub account to view private-repo source.", reconnect: true },
        { status: 403 },
      );
    }
  }

  // 7. Fetch, pinned to the exact analyzed commit so lines match the annotations.
  const ref = snap.analyzedRef || snap.repo.defaultBranch;
  const octokit = makeOctokit(token) as unknown as SourceOctokit;
  const result = await fetchFileSource(octokit, {
    owner: snap.repo.owner,
    repo: snap.repo.name,
    path,
    ref,
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: ERROR_MESSAGE[result.error] },
      { status: ERROR_STATUS[result.error] },
    );
  }

  // 8. Prove alignment; never store the source. Function markers ride along —
  //    a cheap per-path filter (the O(graph) file chips come from the page).
  //    Drop them when the file drifted: their line numbers would be wrong.
  const aligned = isAligned(result.content, expectedHash);
  // The previous snapshot's graph powers the "since last visit" markers.
  const prevCg = session.snapshots[session.snapshots.length - 2]?.codeGraph ?? null;
  return NextResponse.json({
    path,
    ref,
    ext: result.ext,
    bytes: result.bytes,
    content: result.content,
    aligned,
    functions: aligned ? functionMarkersFor(cg, path, prevCg) : [],
  });
}
