// POST /api/cases/check — cheap "has anything changed upstream?" check
// for the signed-in user's cases. Body: { ids: string[] }.
//
// Returns { changed: { [sessionId]: true } } — a session is listed when
// its repo's default-branch HEAD differs from the newest commit in our
// latest snapshot, i.e. a refresh would surface new changes. One light
// GitHub call per case (cached ~15 min), no clone, no analysis. Powers
// the Chambers "New changes" badge.
//
// Best-effort: anything we can't determine (no token, API error, no
// commits to compare) simply isn't flagged — the badge is a nudge, never
// a blocker.

import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getGithubTokenForUser } from "@/lib/githubUserToken";
import { getSession } from "@/lib/storage";
import { parseRepoUrl } from "@/lib/github";
import { getUpstreamHead } from "@/lib/freshness";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_IDS = 40;

export async function POST(req: Request): Promise<NextResponse> {
  const session = await auth.api.getSession({ headers: await headers() });
  const userId = session?.user.id ?? null;
  if (!userId) return NextResponse.json({ changed: {} });

  // The check reads the repo via the caller's token. No token (e.g.
  // email/password account) → we can't check, so nothing is flagged.
  const token = await getGithubTokenForUser(userId);
  if (!token) return NextResponse.json({ changed: {} });

  let ids: string[] = [];
  try {
    const body = await req.json();
    if (Array.isArray(body?.ids)) {
      ids = body.ids
        .filter((x: unknown): x is string => typeof x === "string")
        .slice(0, MAX_IDS);
    }
  } catch {
    // no/invalid body — treat as empty
  }

  const changed: Record<string, boolean> = {};
  await Promise.all(
    ids.map(async (id) => {
      try {
        const sess = await getSession(id);
        if (!sess) return;
        // Only the caller's own cases (strong userId claim).
        if (sess.userId && sess.userId !== userId) return;

        const latest = sess.snapshots[sess.snapshots.length - 1];
        const ourHead = latest?.recentCommits?.[0]?.sha ?? null;
        if (!latest || !ourHead) return; // nothing to compare against

        const parsed = parseRepoUrl(sess.repoUrl);
        if (!parsed) return;

        const upstream = await getUpstreamHead({
          sessionId: id,
          owner: parsed.owner,
          repo: parsed.repo,
          defaultBranch: latest.repo.defaultBranch,
          token,
        });
        if (upstream && upstream !== ourHead) changed[id] = true;
      } catch {
        // skip this case — never let one bad repo fail the whole check
      }
    }),
  );

  return NextResponse.json({ changed });
}
