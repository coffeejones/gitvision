// Cheap "has the repo changed upstream since our latest snapshot?" check
// for the Chambers "New changes" badge. We fetch only the default-branch
// HEAD sha — one GitHub call — and the caller compares it to the newest
// commit in our latest snapshot. No clone, no analysis pipeline.
//
// This is the "check" half of the freshness story; the expensive
// "refresh" (clone + analyze) stays manual — the badge just nudges the
// user to run it. Result is cached per session with a short TTL so
// reloading the workspace doesn't re-hit GitHub every time. We cache the
// upstream HEAD (not a "changed" boolean) so that after a refresh — when
// our latest snapshot advances to that HEAD — the badge clears
// immediately, even within the TTL window.

import { promises as fs } from "node:fs";
import path from "node:path";
import { Octokit } from "octokit";
import { atomicWriteJson } from "./atomicWrite";

const TTL_MS = 15 * 60 * 1000; // re-check a repo at most every 15 min

interface FreshnessCache {
  checkedAt: number;
  head: string | null;
}

function freshDir(): string {
  const dataDir =
    process.env.CODETRAWL_DATA_DIR ?? process.env.REPOBARON_DATA_DIR ?? path.join(process.cwd(), ".gitvision");
  return path.join(dataDir, "freshness");
}

function freshPath(sessionId: string): string {
  const safe = sessionId.replace(/[^A-Za-z0-9_-]/g, "_");
  return path.join(freshDir(), `${safe}.json`);
}

async function readCache(sessionId: string): Promise<FreshnessCache | null> {
  try {
    const raw = await fs.readFile(freshPath(sessionId), "utf-8");
    const parsed = JSON.parse(raw);
    return typeof parsed?.checkedAt === "number"
      ? (parsed as FreshnessCache)
      : null;
  } catch {
    return null;
  }
}

async function writeCache(sessionId: string, c: FreshnessCache): Promise<void> {
  try {
    await fs.mkdir(freshDir(), { recursive: true });
    await atomicWriteJson(freshPath(sessionId), c);
  } catch {
    // best-effort cache — a write failure just means we re-check sooner
  }
}

/** Drop a session's freshness record. Called by deleteSession: this file is
 *  keyed by session id and holds the last commit sha we saw on that
 *  repository, so leaving it behind means "delete this analysis" quietly kept
 *  a note about the repo it came from. Best-effort and never throws — a
 *  failure here must not prevent the session itself from being deleted. */
export async function deleteFreshness(sessionId: string): Promise<void> {
  try {
    await fs.unlink(freshPath(sessionId));
  } catch {
    // no record, or already gone
  }
}

/** Current default-branch HEAD sha for a repo, via a short-TTL cache.
 *  null when it can't be determined (API error, empty repo). Never
 *  throws — freshness is a cosmetic nudge, not a hard dependency. */
export async function getUpstreamHead(opts: {
  sessionId: string;
  owner: string;
  repo: string;
  defaultBranch: string;
  token: string;
}): Promise<string | null> {
  const cached = await readCache(opts.sessionId);
  if (cached && Date.now() - cached.checkedAt < TTL_MS) {
    return cached.head;
  }

  let head: string | null = cached?.head ?? null;
  try {
    const octokit = new Octokit({ auth: opts.token });
    const { data } = await octokit.rest.repos.listCommits({
      owner: opts.owner,
      repo: opts.repo,
      sha: opts.defaultBranch,
      per_page: 1,
    });
    head = data[0]?.sha ?? null;
  } catch {
    // keep the stale cached head on error (better than flapping to null)
  }

  await writeCache(opts.sessionId, { checkedAt: Date.now(), head });
  return head;
}
