// Tests for diffSnapshots + the v0.27 narrative signals
// (newPRsMerged, topNewCommitter, hotspotRankChanges, complexityDelta,
// functionsDelta). Pure logic — uses minimal AnalysisSnapshot fixtures
// so we exercise all the new code paths without touching GitHub.
//
// We don't re-test the pre-v0.27 fields (newCommits, starsDelta,
// newContributors, etc.) — they were already covered implicitly
// through the SinceLastVisit live tests. The tests here lock down the
// new fields specifically.

import { describe, it, expect } from "vitest";
import { diffSnapshots, pickHeadline, type SnapshotDiff } from "../diff";
import type {
  AnalysisSnapshot,
  CommitSummary,
  Contributor,
  FileHotspot,
  PullRequestSummary,
  RepoMeta,
  CodeGraph,
} from "../types";

function repo(): RepoMeta {
  return {
    owner: "owner",
    name: "repo",
    fullName: "owner/repo",
    description: null,
    stars: 100,
    forks: 10,
    watchers: 100,
    openIssues: 5,
    defaultBranch: "main",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-04-29T00:00:00Z",
    pushedAt: "2026-04-29T00:00:00Z",
    language: null,
    license: null,
    homepage: null,
    topics: [],
  };
}

function commit(sha: string, login: string | null = null): CommitSummary {
  return {
    sha,
    message: "msg",
    authorLogin: login,
    authorName: login ?? "unknown",
    authorEmail: `${login ?? "u"}@example.com`,
    date: "2026-04-29T00:00:00Z",
  };
}

function contrib(login: string): Contributor {
  return {
    login,
    avatarUrl: "",
    htmlUrl: "",
    contributions: 1,
  };
}

function hotspot(path: string, score: number): FileHotspot {
  return {
    path,
    churn: score,
    authors: 1,
    authorLogins: [],
    lastModified: "2026-04-29T00:00:00Z",
    score,
    commits: [],
  };
}

function pr(number: number, merged: boolean): PullRequestSummary {
  return {
    number,
    title: `PR #${number}`,
    state: merged ? "closed" : "open",
    merged,
    authorLogin: null,
    createdAt: "2026-04-29T00:00:00Z",
    closedAt: merged ? "2026-04-29T01:00:00Z" : null,
    mergedAt: merged ? "2026-04-29T01:00:00Z" : null,
  };
}

/** Make a snapshot with overridable defaults. */
function snap(over: Partial<AnalysisSnapshot> = {}): AnalysisSnapshot {
  return {
    fetchedAt: "2026-04-29T00:00:00Z",
    repo: repo(),
    contributors: [],
    languages: {},
    recentCommits: [],
    hotspots: [],
    coChange: [],
    commitActivity: [],
    ...over,
  };
}

function codeGraph(
  fileComplexity: Record<string, number>,
  functionCount: number
): CodeGraph {
  return {
    functions: Array.from({ length: functionCount }, (_, i) => ({
      filePath: "x.ts",
      name: `fn${i}`,
      startRow: 0,
      endRow: 0,
      complexity: 1,
    })),
    calls: [],
    imports: [],
    fileComplexity,
    filesByExt: {},
    byPlugin: {},
    generatedAt: "2026-04-29T00:00:00Z",
  };
}

describe("diffSnapshots — newPRsMerged", () => {
  it("counts PRs merged in curr that weren't merged in prev", () => {
    const prev = snap({ pullRequests: [pr(1, true), pr(2, false)] });
    const curr = snap({
      pullRequests: [pr(1, true), pr(2, true), pr(3, true)],
    });
    expect(diffSnapshots(prev, curr).newPRsMerged).toBe(2);
  });

  it("returns 0 when both snapshots have no PRs", () => {
    expect(diffSnapshots(snap(), snap()).newPRsMerged).toBe(0);
  });

  it("returns 0 when curr has only OPEN PRs", () => {
    const prev = snap({ pullRequests: [] });
    const curr = snap({ pullRequests: [pr(1, false), pr(2, false)] });
    expect(diffSnapshots(prev, curr).newPRsMerged).toBe(0);
  });

  it("ignores PRs that were already merged in prev", () => {
    const prev = snap({ pullRequests: [pr(1, true), pr(2, true)] });
    const curr = snap({ pullRequests: [pr(1, true), pr(2, true)] });
    expect(diffSnapshots(prev, curr).newPRsMerged).toBe(0);
  });
});

describe("diffSnapshots — topNewCommitter", () => {
  it("returns the author with the most new commits", () => {
    const prev = snap({ recentCommits: [commit("old1", "alice")] });
    const curr = snap({
      recentCommits: [
        commit("old1", "alice"),
        commit("new1", "alice"),
        commit("new2", "alice"),
        commit("new3", "bob"),
      ],
    });
    expect(diffSnapshots(prev, curr).topNewCommitter).toEqual({
      login: "alice",
      count: 2,
    });
  });

  it("returns null when there are no new commits", () => {
    expect(diffSnapshots(snap(), snap()).topNewCommitter).toBeNull();
  });

  it("returns null when all new commits have unknown authors", () => {
    const prev = snap();
    const curr = snap({
      recentCommits: [commit("a", null), commit("b", null)],
    });
    expect(diffSnapshots(prev, curr).topNewCommitter).toBeNull();
  });

  it("ties break by first-seen order (deterministic)", () => {
    // alice and bob each have 2 new commits; alice's commits appear first
    // in the iteration → alice wins. We use Map insertion order, which
    // mirrors recentCommits order — predictable behavior.
    const prev = snap();
    const curr = snap({
      recentCommits: [
        commit("a1", "alice"),
        commit("b1", "bob"),
        commit("a2", "alice"),
        commit("b2", "bob"),
      ],
    });
    expect(diffSnapshots(prev, curr).topNewCommitter?.login).toBe("alice");
  });

  it("ignores null-author commits when other commits have authors", () => {
    const prev = snap();
    const curr = snap({
      recentCommits: [
        commit("a", null),
        commit("b", null),
        commit("c", "alice"),
      ],
    });
    expect(diffSnapshots(prev, curr).topNewCommitter).toEqual({
      login: "alice",
      count: 1,
    });
  });
});

describe("diffSnapshots — hotspotRankChanges", () => {
  it("captures rank shifts for files in both top-20 lists", () => {
    // prev order: a.ts (#1) | b.ts (#2) | c.ts (#3)
    // curr order: c.ts (#1) | a.ts (#2) | b.ts (#3)
    const prev = snap({
      hotspots: [
        hotspot("a.ts", 100),
        hotspot("b.ts", 80),
        hotspot("c.ts", 60),
      ],
    });
    const curr = snap({
      hotspots: [
        hotspot("c.ts", 200),
        hotspot("a.ts", 150),
        hotspot("b.ts", 80),
      ],
    });
    const changes = diffSnapshots(prev, curr).hotspotRankChanges;
    // Sorted by absolute movement: c.ts moved 2 positions (#3 → #1),
    // a.ts and b.ts each moved 1.
    expect(changes).toEqual([
      { path: "c.ts", fromRank: 3, toRank: 1 },
      { path: "a.ts", fromRank: 1, toRank: 2 },
      { path: "b.ts", fromRank: 2, toRank: 3 },
    ]);
  });

  it("excludes files that newly entered the top 20 (those are newHotspots)", () => {
    const prev = snap({
      hotspots: [hotspot("a.ts", 100), hotspot("b.ts", 80)],
    });
    const curr = snap({
      hotspots: [
        hotspot("a.ts", 100),
        hotspot("b.ts", 80),
        hotspot("c.ts", 60), // new — not in prev top 20
      ],
    });
    expect(diffSnapshots(prev, curr).hotspotRankChanges).toEqual([]);
  });

  it("returns an empty array when ranks are stable", () => {
    const list = [hotspot("a.ts", 100), hotspot("b.ts", 80)];
    const prev = snap({ hotspots: list });
    const curr = snap({ hotspots: list });
    expect(diffSnapshots(prev, curr).hotspotRankChanges).toEqual([]);
  });

  it("caps the result at 5 entries", () => {
    const prevList = Array.from({ length: 10 }, (_, i) =>
      hotspot(`f${i}.ts`, 1000 - i)
    );
    // Reverse order — every file's rank changes
    const currList = [...prevList].reverse();
    const prev = snap({ hotspots: prevList });
    const curr = snap({ hotspots: currList });
    expect(diffSnapshots(prev, curr).hotspotRankChanges).toHaveLength(5);
  });
});

describe("diffSnapshots — complexityDelta + functionsDelta", () => {
  it("computes both deltas when both snapshots have a codeGraph", () => {
    const prev = snap({ codeGraph: codeGraph({ "a.ts": 10, "b.ts": 5 }, 8) });
    const curr = snap({ codeGraph: codeGraph({ "a.ts": 12, "b.ts": 8 }, 12) });
    const d = diffSnapshots(prev, curr);
    expect(d.complexityDelta).toBe(5); // (12+8) - (10+5)
    expect(d.functionsDelta).toBe(4); // 12 - 8
  });

  it("returns null for both when prev lacks codeGraph (legacy snapshot)", () => {
    const prev = snap();
    const curr = snap({ codeGraph: codeGraph({ "a.ts": 10 }, 5) });
    const d = diffSnapshots(prev, curr);
    expect(d.complexityDelta).toBeNull();
    expect(d.functionsDelta).toBeNull();
  });

  it("returns null for both when curr lacks codeGraph (analysis was skipped)", () => {
    const prev = snap({ codeGraph: codeGraph({ "a.ts": 10 }, 5) });
    const curr = snap();
    const d = diffSnapshots(prev, curr);
    expect(d.complexityDelta).toBeNull();
    expect(d.functionsDelta).toBeNull();
  });

  it("returns 0 deltas (not null) when both codeGraphs are present but identical", () => {
    const cg = codeGraph({ "a.ts": 10 }, 5);
    const prev = snap({ codeGraph: cg });
    const curr = snap({ codeGraph: cg });
    const d = diffSnapshots(prev, curr);
    expect(d.complexityDelta).toBe(0);
    expect(d.functionsDelta).toBe(0);
  });

  it("computes negative deltas when complexity / functions decrease", () => {
    const prev = snap({ codeGraph: codeGraph({ "a.ts": 50 }, 20) });
    const curr = snap({ codeGraph: codeGraph({ "a.ts": 30 }, 15) });
    const d = diffSnapshots(prev, curr);
    expect(d.complexityDelta).toBe(-20);
    expect(d.functionsDelta).toBe(-5);
  });
});

describe("diffSnapshots — combined no-change case", () => {
  it("returns zero/null/empty across all v0.27 signals on identical snapshots", () => {
    const s = snap({
      contributors: [contrib("alice")],
      recentCommits: [commit("a", "alice")],
      hotspots: [hotspot("foo.ts", 10)],
      pullRequests: [pr(1, true)],
      codeGraph: codeGraph({ "foo.ts": 5 }, 3),
    });
    const d = diffSnapshots(s, s);
    expect(d.newPRsMerged).toBe(0);
    expect(d.topNewCommitter).toBeNull();
    expect(d.hotspotRankChanges).toEqual([]);
    expect(d.complexityDelta).toBe(0);
    expect(d.functionsDelta).toBe(0);
  });
});

// ------------------- pickHeadline -------------------

/** Build an empty SnapshotDiff with all fields zero/null/empty so each
 *  test only sets the field(s) it cares about. */
function emptyDiff(): SnapshotDiff {
  return {
    from: "2026-04-29T00:00:00Z",
    to: "2026-04-29T00:00:00Z",
    newCommits: 0,
    starsDelta: 0,
    forksDelta: 0,
    openIssuesDelta: 0,
    newContributors: [],
    newHotspots: [],
    risingHotspots: [],
    newPRsMerged: 0,
    topNewCommitter: null,
    hotspotRankChanges: [],
    complexityDelta: null,
    functionsDelta: null,
  };
}

describe("pickHeadline — priority", () => {
  it("returns null when nothing changed", () => {
    expect(pickHeadline(emptyDiff())).toBeNull();
  });

  it("contributors take priority over everything else", () => {
    const d: SnapshotDiff = {
      ...emptyDiff(),
      newContributors: ["alice", "bob"],
      newCommits: 100,
      starsDelta: 50,
      hotspotRankChanges: [{ path: "main.ts", fromRank: 10, toRank: 1 }],
      complexityDelta: 500,
      topNewCommitter: { login: "alice", count: 12 },
    };
    expect(pickHeadline(d)).toEqual({
      kind: "contributors",
      count: 2,
      lead: { login: "alice", count: 12 },
    });
  });

  it("hotspot-rise takes priority over commits / complexity / stars", () => {
    const d: SnapshotDiff = {
      ...emptyDiff(),
      hotspotRankChanges: [{ path: "main.ts", fromRank: 8, toRank: 2 }],
      newCommits: 50,
      starsDelta: 100,
      complexityDelta: 100,
    };
    expect(pickHeadline(d)).toEqual({
      kind: "hotspot-rise",
      path: "main.ts",
      fromRank: 8,
      toRank: 2,
    });
  });

  it("only counts hotspot rises that ENTER the top 3", () => {
    // Moves entirely outside the top 3 don't qualify as a leading story
    const d: SnapshotDiff = {
      ...emptyDiff(),
      hotspotRankChanges: [
        { path: "x.ts", fromRank: 18, toRank: 12 }, // big move, but still outside top 3
        { path: "y.ts", fromRank: 6, toRank: 4 }, // close, but didn't reach top 3
      ],
      newCommits: 5,
    };
    const h = pickHeadline(d);
    // Falls through to commits — no hotspot-rise headline
    expect(h?.kind).toBe("commits");
  });

  it("picks the most dramatic hotspot-rise (largest fromRank) when several qualify", () => {
    const d: SnapshotDiff = {
      ...emptyDiff(),
      hotspotRankChanges: [
        { path: "small.ts", fromRank: 5, toRank: 2 }, // 3-position climb
        { path: "big.ts", fromRank: 18, toRank: 1 }, // 17-position climb — this should win
        { path: "med.ts", fromRank: 8, toRank: 3 }, // 5-position climb
      ],
    };
    const h = pickHeadline(d);
    expect(h).toEqual({
      kind: "hotspot-rise",
      path: "big.ts",
      fromRank: 18,
      toRank: 1,
    });
  });

  it("complexity-spike beats commits when delta is large enough", () => {
    const d: SnapshotDiff = {
      ...emptyDiff(),
      complexityDelta: 50,
      newCommits: 10,
    };
    expect(pickHeadline(d)).toEqual({ kind: "complexity-spike", delta: 50 });
  });

  it("ignores complexity deltas below the threshold (small refactors are noise)", () => {
    const d: SnapshotDiff = {
      ...emptyDiff(),
      complexityDelta: 15, // below COMPLEXITY_HEADLINE_THRESHOLD (20)
      newCommits: 3,
    };
    const h = pickHeadline(d);
    expect(h?.kind).toBe("commits");
  });

  it("complexity-spike fires for negative deltas too (refactors are stories)", () => {
    const d: SnapshotDiff = {
      ...emptyDiff(),
      complexityDelta: -45,
      newCommits: 5,
    };
    expect(pickHeadline(d)).toEqual({ kind: "complexity-spike", delta: -45 });
  });

  it("commits fallback fires when no higher-priority signals are present", () => {
    const d: SnapshotDiff = {
      ...emptyDiff(),
      newCommits: 7,
      topNewCommitter: { login: "alice", count: 5 },
    };
    expect(pickHeadline(d)).toEqual({
      kind: "commits",
      count: 7,
      lead: { login: "alice", count: 5 },
    });
  });

  it("commits fallback works without a topNewCommitter (anonymous activity)", () => {
    const d: SnapshotDiff = {
      ...emptyDiff(),
      newCommits: 7,
      topNewCommitter: null,
    };
    expect(pickHeadline(d)).toEqual({
      kind: "commits",
      count: 7,
      lead: null,
    });
  });

  it("stars fallback fires only when nothing else changed", () => {
    const d: SnapshotDiff = { ...emptyDiff(), starsDelta: 12 };
    expect(pickHeadline(d)).toEqual({ kind: "stars", delta: 12 });
  });

  it("stars decreasing does NOT fire (would be a sad headline)", () => {
    // Star losses happen but aren't a story we want to lead with.
    const d: SnapshotDiff = { ...emptyDiff(), starsDelta: -3 };
    expect(pickHeadline(d)).toBeNull();
  });

  it("returns null when complexityDelta is null (no codeGraph) and nothing else changed", () => {
    const d: SnapshotDiff = { ...emptyDiff(), complexityDelta: null };
    expect(pickHeadline(d)).toBeNull();
  });
});
