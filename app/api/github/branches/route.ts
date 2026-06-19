// GET /api/github/branches?repo=owner/repo (or a full GitHub URL)
//
// Lists a repository's branches for the pre-analysis config picker, with the
// default branch first. Uses the signed-in user's GitHub token when present
// (private-repo access + their own rate budget), falling back to the server
// PAT for public repos. Doubles as an early repo-existence/access check, so
// the config box can surface "not found / no access" before a full sweep.

import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { Octokit } from "octokit";
import { auth } from "@/lib/auth";
import { getGithubTokenForUser } from "@/lib/githubUserToken";
import { parseRepoUrl } from "@/lib/github";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PER_PAGE = 100;
const MAX_PAGES = 3; // up to 300 branches; the picker filters client-side

export async function GET(req: Request): Promise<NextResponse> {
  const session = await auth.api.getSession({ headers: await headers() });
  const userId = session?.user.id ?? null;
  if (!userId) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const repoParam = new URL(req.url).searchParams.get("repo") ?? "";
  const parsed = parseRepoUrl(repoParam);
  if (!parsed) {
    return NextResponse.json(
      { error: "Could not parse that repository." },
      { status: 400 },
    );
  }
  const { owner, repo } = parsed;

  // User token (private repos + isolated budget) → server PAT → unauthenticated.
  // This is also the natural seam for a future Plus-only branch gate: a free
  // tier could 402 here instead of listing.
  const token =
    (await getGithubTokenForUser(userId)) ?? process.env.GITHUB_TOKEN ?? null;
  const octokit = new Octokit(token ? { auth: token } : {});

  try {
    const meta = await octokit.rest.repos.get({ owner, repo });
    const defaultBranch = meta.data.default_branch;

    const branches: string[] = [];
    let truncated = false;
    for (let page = 1; page <= MAX_PAGES; page++) {
      const { data } = await octokit.rest.repos.listBranches({
        owner,
        repo,
        per_page: PER_PAGE,
        page,
      });
      for (const b of data) branches.push(b.name);
      if (data.length < PER_PAGE) break;
      if (page === MAX_PAGES) truncated = true;
    }

    // Default branch first, then alphabetical.
    branches.sort((a, b) => {
      if (a === defaultBranch) return -1;
      if (b === defaultBranch) return 1;
      return a.localeCompare(b);
    });

    return NextResponse.json({ defaultBranch, branches, truncated });
  } catch (err) {
    const status =
      typeof err === "object" && err !== null && "status" in err
        ? (err as { status?: number }).status
        : undefined;
    if (status === 404) {
      return NextResponse.json(
        { error: "Repository not found, or you don't have access to it." },
        { status: 404 },
      );
    }
    if (status === 401 || status === 403) {
      return NextResponse.json(
        {
          error:
            "Couldn't access this repository. If it's private, connect GitHub with repo access.",
        },
        { status: 403 },
      );
    }
    console.error("[github/branches] list failed:", err);
    return NextResponse.json(
      { error: "Couldn't load branches. Try again." },
      { status: 502 },
    );
  }
}
