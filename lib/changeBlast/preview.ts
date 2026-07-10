// Change-blast preview orchestrator (Arc 5, beat 1). Resolves a PR to its base
// + head endpoints, analyzes both refs, and computes the change-blast. Runs
// inside a background job (the two analyses are minutes-long); the route + UI
// wrap it. Server-only (calls analyzeRepo).

import { analyzeRepo, fetchPrRefs, type PrRefEndpoint } from "../github";
import type { AnalysisSnapshot } from "../types";
import { computeChangeBlast } from "./compute";
import type { ChangeBlastReport } from "./types";

// A commit SHA is immutable, so analysis keyed on (owner/repo@sha) is always
// reusable — the base (usually main) is shared across every PR against it, and
// re-viewing the same PR is free. Small in-process cache with a TTL.
const cache = new Map<string, { snap: AnalysisSnapshot; at: number }>();
const TTL_MS = 15 * 60 * 1000;
const MAX_ENTRIES = 40;

async function analyzeRef(
  ep: PrRefEndpoint,
  userToken?: string | null,
): Promise<AnalysisSnapshot> {
  const key = `${ep.owner}/${ep.repo}@${ep.sha}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.snap;

  const snap = await analyzeRepo(ep.owner, ep.repo, {
    ref: ep.sha,
    userToken,
  });
  cache.set(key, { snap, at: Date.now() });
  // Evict the oldest entry (Map preserves insertion order) past the cap.
  if (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  return snap;
}

export interface PreviewResult {
  pr: {
    owner: string;
    repo: string;
    number: number;
    title: string;
    baseRef: string;
    headRef: string;
  };
  report: ChangeBlastReport;
}

/** Analyze a PR's base + head and map the diff onto blast reach. The two
 *  analyses run sequentially to bound peak memory (each clones + parses a repo);
 *  the SHA cache makes the base ~free on repeated PRs against the same branch. */
export async function runChangeBlastPreview(input: {
  owner: string;
  repo: string;
  number: number;
  userToken?: string | null;
}): Promise<PreviewResult> {
  const refs = await fetchPrRefs(
    input.owner,
    input.repo,
    input.number,
    input.userToken,
  );

  const base = await analyzeRef(refs.base, input.userToken);
  const head = await analyzeRef(refs.head, input.userToken);
  const report = computeChangeBlast(base, head);

  return {
    pr: {
      owner: input.owner,
      repo: input.repo,
      number: input.number,
      title: refs.title,
      baseRef: refs.base.ref,
      headRef: refs.head.ref,
    },
    report,
  };
}
