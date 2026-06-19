// GET /api/github/repos?page=N
//
// Lists the signed-in user's PRIVATE GitHub repositories (most-recently
// pushed first), paginated, using their stored OAuth token. Powers the
// Chambers "Private" tab — pick a repo to put it on trial.
//
// Returns { connected: false } (200) when the user has no GitHub token
// or it lacks `repo` scope, so the UI can show a "connect" prompt
// instead of an error.

import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { Octokit } from "octokit";
import { auth } from "@/lib/auth";
import { canAccess } from "@/lib/billing/gates";
import { getGithubTokenForUser } from "@/lib/githubUserToken";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Fetch in big chunks so the client can hold the full list in memory
// for instant search + local 8-per-page pagination.
const PER_PAGE = 100;

export async function GET(req: Request): Promise<NextResponse> {
  const session = await auth.api.getSession({ headers: await headers() });
  const userId = session?.user.id ?? null;
  if (!userId) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  // Tier gate: analyzing private repos is a Plus feature, so Free users
  // shouldn't even see their private repo list. Signal `upgrade` (200) so the
  // Private tab can render an upgrade prompt instead of the connect prompt.
  if (!(await canAccess(userId, "privateRepos"))) {
    return NextResponse.json({
      connected: true,
      upgrade: true,
      repos: [],
      hasMore: false,
    });
  }

  const token = await getGithubTokenForUser(userId);
  if (!token) {
    // No linked GitHub token (email/password account, or token not
    // stored). Not an error — the UI shows a connect prompt.
    return NextResponse.json({ connected: false, repos: [], hasMore: false });
  }

  const page = Math.max(
    1,
    Number.parseInt(new URL(req.url).searchParams.get("page") ?? "1", 10) || 1,
  );

  try {
    const octokit = new Octokit({ auth: token });
    const { data } = await octokit.rest.repos.listForAuthenticatedUser({
      visibility: "private",
      sort: "pushed",
      per_page: PER_PAGE,
      page,
    });

    const repos = data.map((r) => ({
      fullName: r.full_name,
      name: r.name,
      pushedAt: r.pushed_at ?? null,
      language: r.language ?? null,
    }));

    return NextResponse.json({
      connected: true,
      repos,
      page,
      hasMore: data.length === PER_PAGE,
    });
  } catch (err) {
    // A 401/403 here usually means the token lacks `repo` scope (only
    // read:user/user:email granted) — surface as "not connected" so the
    // UI nudges a re-authorize rather than showing a hard error.
    const status =
      typeof err === "object" && err !== null && "status" in err
        ? (err as { status?: number }).status
        : undefined;
    if (status === 401 || status === 403) {
      return NextResponse.json({ connected: false, repos: [], hasMore: false });
    }
    console.error("[github/repos] list failed:", err);
    return NextResponse.json(
      { error: "Could not load repositories" },
      { status: 502 },
    );
  }
}
