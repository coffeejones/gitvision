// "Since last visit" — compute the delta between two snapshots for a given session.
//
// v0.27 expanded the diff with five storytelling signals (newPRsMerged,
// topNewCommitter, hotspotRankChanges, complexityDelta, functionsDelta)
// so the SinceLastVisit banner can pick a leading headline instead of
// rendering a flat list of numbers. Each new signal is best-effort —
// missing source data (e.g. no codeGraph on either snapshot) just makes
// that field zero/null/empty, never throws.

import type { AnalysisSnapshot } from "./types";

export interface HotspotRankChange {
  path: string;
  fromRank: number;
  toRank: number;
}

export interface SnapshotDiff {
  from: string; // ISO fetchedAt of previous snapshot
  to: string; // ISO fetchedAt of current snapshot
  newCommits: number;
  starsDelta: number;
  forksDelta: number;
  openIssuesDelta: number;
  newContributors: string[]; // logins
  newHotspots: string[]; // file paths that are new in top 20
  risingHotspots: { path: string; fromScore: number; toScore: number }[];

  // ------------------- v0.27 narrative signals -------------------

  /** PRs that landed (merged) in the diff window. We diff by PR number;
   *  any merged PR in `curr` that wasn't merged in `prev` counts. */
  newPRsMerged: number;
  /** Author with the most commits in the diff window (newCommits). null
   *  when no new commits, or when all new commits have unknown authors. */
  topNewCommitter: { login: string; count: number } | null;
  /** Hotspots whose top-20 rank shifted between snapshots. Includes both
   *  files that climbed and files that fell. Sorted by absolute change,
   *  capped at 5 entries — used for "X.cs is now your biggest hotspot,
   *  up from #5" headlines. */
  hotspotRankChanges: HotspotRankChange[];
  /** Sum of fileComplexity across all files: curr - prev. Positive
   *  means code is getting more branching-heavy, negative means
   *  refactors / deletions are winning. null when either snapshot
   *  lacks a codeGraph (legacy data, or analysis was skipped). */
  complexityDelta: number | null;
  /** Total functions across all files: curr - prev. Same null-when-
   *  missing semantics as complexityDelta. */
  functionsDelta: number | null;
}

export function diffSnapshots(prev: AnalysisSnapshot, curr: AnalysisSnapshot): SnapshotDiff {
  const prevShas = new Set(prev.recentCommits.map((c) => c.sha));
  const newCommitsList = curr.recentCommits.filter((c) => !prevShas.has(c.sha));
  const newCommits = newCommitsList.length;

  const prevContribLogins = new Set(prev.contributors.map((c) => c.login));
  const newContributors = curr.contributors
    .filter((c) => !prevContribLogins.has(c.login))
    .map((c) => c.login);

  // Hotspot tracking — we track top-20 ranks (1-indexed) so we can both
  // report "newly entered the top 20" and "rank shifted within top 20".
  const prevTopRanks = new Map(
    prev.hotspots.slice(0, 20).map((h, idx) => [h.path, idx + 1])
  );
  const prevTopScores = new Map(
    prev.hotspots.slice(0, 20).map((h) => [h.path, h.score])
  );
  const currTop = curr.hotspots.slice(0, 20);
  const newHotspots = currTop.filter((h) => !prevTopRanks.has(h.path)).map((h) => h.path);
  const risingHotspots = currTop
    .filter((h) => prevTopScores.has(h.path) && h.score > prevTopScores.get(h.path)!)
    .map((h) => ({
      path: h.path,
      fromScore: prevTopScores.get(h.path)!,
      toScore: h.score,
    }));

  // Rank changes — compare ranks for files present in both top-20 lists.
  // We only care about FILES that are in BOTH (otherwise it's a "new
  // hotspot" already covered above).
  const hotspotRankChanges: HotspotRankChange[] = [];
  for (let i = 0; i < currTop.length; i++) {
    const path = currTop[i].path;
    const fromRank = prevTopRanks.get(path);
    if (fromRank === undefined) continue; // not in prev top 20
    const toRank = i + 1;
    if (fromRank !== toRank) {
      hotspotRankChanges.push({ path, fromRank, toRank });
    }
  }
  // Sort by absolute rank movement, descending — biggest jumps first.
  hotspotRankChanges.sort(
    (a, b) =>
      Math.abs(b.fromRank - b.toRank) - Math.abs(a.fromRank - a.toRank)
  );
  const cappedHotspotRankChanges = hotspotRankChanges.slice(0, 5);

  // PR diff — count merged PRs that are new in curr.
  const prevMergedNumbers = new Set(
    (prev.pullRequests ?? []).filter((p) => p.merged).map((p) => p.number)
  );
  const newPRsMerged = (curr.pullRequests ?? []).filter(
    (p) => p.merged && !prevMergedNumbers.has(p.number)
  ).length;

  // Top new committer — group new commits by authorLogin.
  const commitsByAuthor = new Map<string, number>();
  for (const c of newCommitsList) {
    if (!c.authorLogin) continue; // skip unknown / unauthenticated
    commitsByAuthor.set(
      c.authorLogin,
      (commitsByAuthor.get(c.authorLogin) ?? 0) + 1
    );
  }
  let topNewCommitter: { login: string; count: number } | null = null;
  for (const [login, count] of commitsByAuthor) {
    if (!topNewCommitter || count > topNewCommitter.count) {
      topNewCommitter = { login, count };
    }
  }

  // Code-graph deltas — null when either side is missing the data
  // (legacy snapshots, or analysis was skipped on a big repo).
  let complexityDelta: number | null = null;
  let functionsDelta: number | null = null;
  if (prev.codeGraph && curr.codeGraph) {
    const sumComplexity = (cg: typeof prev.codeGraph) =>
      Object.values(cg!.fileComplexity).reduce((a, b) => a + b, 0);
    complexityDelta = sumComplexity(curr.codeGraph) - sumComplexity(prev.codeGraph);
    functionsDelta =
      curr.codeGraph.functions.length - prev.codeGraph.functions.length;
  }

  return {
    from: prev.fetchedAt,
    to: curr.fetchedAt,
    newCommits,
    starsDelta: curr.repo.stars - prev.repo.stars,
    forksDelta: curr.repo.forks - prev.repo.forks,
    openIssuesDelta: curr.repo.openIssues - prev.repo.openIssues,
    newContributors,
    newHotspots,
    risingHotspots,
    newPRsMerged,
    topNewCommitter,
    hotspotRankChanges: cappedHotspotRankChanges,
    complexityDelta,
    functionsDelta,
  };
}

// ------------------- Headline selection (v0.27) -------------------
//
// The SinceLastVisit banner picks ONE leading headline from a diff
// rather than rendering all signals as equal-weight chips. This file
// owns the priority logic so it stays testable as a pure function and
// the UI component is just rendering — no business decisions in JSX.
//
// Priority (highest first):
//   1. New contributors  — any new face is a story worth leading with
//   2. Hotspot rise      — file climbed into the top 3 from outside it
//   3. Complexity spike  — codeGraph delta crosses a meaningful threshold
//   4. New commits       — fallback narrative when nothing else stands out
//   5. Stars             — smallest story but better than nothing
//   6. null              — no change worth headlining; banner shows
//                          "nothing new since your last visit"

export type Headline =
  | {
      kind: "contributors";
      count: number;
      /** Top committer in the diff window. Uses the same `count` field
       *  name as SnapshotDiff.topNewCommitter so headline-rendering
       *  code can pass the value through unchanged. */
      lead: { login: string; count: number } | null;
    }
  | {
      kind: "hotspot-rise";
      path: string;
      fromRank: number;
      toRank: number;
    }
  | { kind: "complexity-spike"; delta: number }
  | {
      kind: "commits";
      count: number;
      lead: { login: string; count: number } | null;
    }
  | { kind: "stars"; delta: number };

/** Threshold for when a complexity delta is worth leading with. We've
 *  seen typical refactors move ±5-15 across a small repo's whole tree;
 *  20+ is a clear "significant change" signal. */
const COMPLEXITY_HEADLINE_THRESHOLD = 20;

/** Threshold for "moved into the top tier" — a file climbing from #5 to
 *  #2 is a story; #20 to #15 is just churn. */
const HOTSPOT_TIER_THRESHOLD = 3;

export function pickHeadline(diff: SnapshotDiff): Headline | null {
  // 1. New contributors — any number ≥ 1 is real, narrative-worthy news
  if (diff.newContributors.length > 0) {
    return {
      kind: "contributors",
      count: diff.newContributors.length,
      lead: diff.topNewCommitter,
    };
  }

  // 2. Dramatic hotspot rise — entered the top 3 from outside it. Pick
  //    the most dramatic such move (largest fromRank value); ties broken
  //    by toRank (higher position wins).
  const rises = diff.hotspotRankChanges
    .filter(
      (c) => c.toRank <= HOTSPOT_TIER_THRESHOLD && c.fromRank > HOTSPOT_TIER_THRESHOLD
    )
    .sort((a, b) => b.fromRank - a.fromRank || a.toRank - b.toRank);
  if (rises.length > 0) {
    return {
      kind: "hotspot-rise",
      path: rises[0].path,
      fromRank: rises[0].fromRank,
      toRank: rises[0].toRank,
    };
  }

  // 3. Significant complexity shift in either direction
  if (
    diff.complexityDelta !== null &&
    Math.abs(diff.complexityDelta) >= COMPLEXITY_HEADLINE_THRESHOLD
  ) {
    return { kind: "complexity-spike", delta: diff.complexityDelta };
  }

  // 4. New commits — fallback narrative when nothing more interesting
  //    happened
  if (diff.newCommits > 0) {
    return {
      kind: "commits",
      count: diff.newCommits,
      lead: diff.topNewCommitter,
    };
  }

  // 5. Stars — smallest story
  if (diff.starsDelta > 0) {
    return { kind: "stars", delta: diff.starsDelta };
  }

  return null;
}
