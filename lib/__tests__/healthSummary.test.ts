// Tests for summarizeHealth() — maps signal output into 6 traffic-light
// dimensions. We build snapshots that trigger real detectors in
// lib/signals.ts (rather than mocking signal output) so the tests double
// as integration coverage: a breaking change in signals.ts that shifts
// IDs or severities will surface here too.

import { describe, it, expect } from "vitest";
import {
  summarizeHealth,
  type DimensionId,
  type DimensionStatus,
} from "../intelligence/healthSummary";
import type {
  AnalysisSnapshot,
  CommitSummary,
  Contributor,
  DependencyHealth,
  FileHotspot,
  PullRequestSummary,
} from "../types";

// ---------------- Fixture builders ----------------

/** pushedAt 30 days ago — sits between the very-active (<7d) and stale
 *  (>90d) thresholds in detectActivityRecency, so the activity dimension
 *  stays "unknown" by default. Override per-test when activity status
 *  is what's being verified. */
const NEUTRAL_PUSHED_AT = new Date(
  Date.now() - 30 * 24 * 3600 * 1000
).toISOString();

function snap(overrides: Partial<AnalysisSnapshot> = {}): AnalysisSnapshot {
  return {
    fetchedAt: "2026-05-06T00:00:00Z",
    repo: {
      owner: "acme",
      name: "widget",
      fullName: "acme/widget",
      description: null,
      stars: 0,
      forks: 0,
      watchers: 0,
      openIssues: 0,
      defaultBranch: "main",
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: NEUTRAL_PUSHED_AT,
      pushedAt: NEUTRAL_PUSHED_AT,
      language: "TypeScript",
      license: "MIT",
      homepage: null,
      topics: [],
    },
    contributors: [],
    languages: {},
    recentCommits: [],
    hotspots: [],
    coChange: [],
    commitActivity: [],
    hasReadme: true,
    ...overrides,
  };
}

function commit(date: string, login = "alice"): CommitSummary {
  return {
    sha: Math.random().toString(36).slice(2),
    message: "test",
    authorLogin: login,
    authorName: login,
    authorEmail: `${login}@example.com`,
    date,
  };
}

function hotspot(path: string, churn: number, authorLogins: string[]): FileHotspot {
  return {
    path,
    churn,
    authors: authorLogins.length,
    authorLogins,
    lastModified: "2026-05-01T00:00:00Z",
    score: churn,
    commits: [],
  };
}

function depHealth(opts: Partial<DependencyHealth> = {}): DependencyHealth {
  return {
    ecosystem: "npm",
    total: 10,
    outdated: [],
    vulnerable: [],
    deprecated: [],
    analyzedAt: "2026-05-06T00:00:00Z",
    ...opts,
  };
}

function findDimension(
  summaries: ReturnType<typeof summarizeHealth>,
  id: DimensionId
) {
  const dim = summaries.find((d) => d.id === id);
  if (!dim) throw new Error(`Dimension ${id} missing from summaries`);
  return dim;
}

const expectStatus = (
  summaries: ReturnType<typeof summarizeHealth>,
  id: DimensionId,
  status: DimensionStatus
) => expect(findDimension(summaries, id).status).toBe(status);

// ---------------- Order + shape ----------------

describe("summarizeHealth · shape", () => {
  it("returns exactly 6 dimensions in fixed order", () => {
    const summaries = summarizeHealth(snap());
    expect(summaries.map((d) => d.id)).toEqual([
      "activity",
      "team",
      "code",
      "pr-flow",
      "deps",
      "hygiene",
    ]);
  });

  it("each dimension carries label, status, statusLabel, signalCount", () => {
    const summaries = summarizeHealth(snap());
    for (const d of summaries) {
      expect(typeof d.label).toBe("string");
      expect(d.label.length).toBeGreaterThan(0);
      expect(typeof d.status).toBe("string");
      expect(typeof d.statusLabel).toBe("string");
      expect(typeof d.signalCount).toBe("number");
    }
  });
});

// ---------------- Default / empty snapshot ----------------

describe("summarizeHealth · empty snapshot defaults", () => {
  it("defaults most dimensions to unknown but hygiene to healthy", () => {
    const summaries = summarizeHealth(snap());
    expectStatus(summaries, "activity", "unknown");
    expectStatus(summaries, "team", "unknown");
    expectStatus(summaries, "code", "unknown");
    expectStatus(summaries, "pr-flow", "unknown");
    expectStatus(summaries, "deps", "unknown");
    // Hygiene defaults to healthy: silence on missing-hygiene + metadata-
    // dominance is genuinely good news, not absent data.
    expectStatus(summaries, "hygiene", "healthy");
  });
});

// ---------------- Activity ----------------

describe("summarizeHealth · activity", () => {
  it("flags critical on > 1 year stale", () => {
    const longAgo = new Date(
      Date.now() - 400 * 24 * 3600 * 1000
    ).toISOString();
    const summaries = summarizeHealth(
      snap({ recentCommits: [commit(longAgo)] })
    );
    expectStatus(summaries, "activity", "critical");
  });

  it("flags warning on stale but < 1 year", () => {
    const stale = new Date(Date.now() - 120 * 24 * 3600 * 1000).toISOString();
    const summaries = summarizeHealth(
      snap({ recentCommits: [commit(stale)] })
    );
    expectStatus(summaries, "activity", "warning");
  });

  it("flags healthy on a very recent commit (very-active fires)", () => {
    const recent = new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString();
    const summaries = summarizeHealth(
      snap({ recentCommits: [commit(recent)] })
    );
    expectStatus(summaries, "activity", "healthy");
  });

  it("flags healthy when consistent-cadence fires", () => {
    // Build commitActivity: 6+ weeks, ≥60% with activity
    const summaries = summarizeHealth(
      snap({
        commitActivity: [
          { week: "2026-W14", count: 5 },
          { week: "2026-W15", count: 3 },
          { week: "2026-W16", count: 4 },
          { week: "2026-W17", count: 0 },
          { week: "2026-W18", count: 6 },
          { week: "2026-W19", count: 2 },
        ],
        recentCommits: [
          commit(new Date(Date.now() - 5 * 24 * 3600 * 1000).toISOString()),
        ],
      })
    );
    expectStatus(summaries, "activity", "healthy");
  });
});

// ---------------- Team (solo special case) ----------------

describe("summarizeHealth · team solo special case", () => {
  it("status='solo' when only solo-project fires (not warning)", () => {
    // All hotspots single-owner + ≥5 commits triggers solo-project
    const recent = new Date(Date.now() - 5 * 24 * 3600 * 1000).toISOString();
    const summaries = summarizeHealth(
      snap({
        hotspots: [
          hotspot("src/foo.ts", 10, ["jonas"]),
          hotspot("src/bar.ts", 5, ["jonas"]),
        ],
        recentCommits: Array.from({ length: 6 }, () => commit(recent, "jonas")),
      })
    );
    const team = findDimension(summaries, "team");
    expect(team.status).toBe("solo");
    expect(team.statusLabel).toBe("Solo");
  });

  it("flags healthy when many-contributors fires (20+ contributors)", () => {
    const contributors: Contributor[] = Array.from({ length: 25 }, (_, i) => ({
      login: `dev${i}`,
      avatarUrl: "",
      htmlUrl: "",
      contributions: 100 - i,
    }));
    const summaries = summarizeHealth(snap({ contributors }));
    expectStatus(summaries, "team", "healthy");
  });
});

// ---------------- Dependencies ----------------

describe("summarizeHealth · dependencies", () => {
  it("flags critical on vulnerable deps", () => {
    const summaries = summarizeHealth(
      snap({
        dependencyHealths: [
          depHealth({
            vulnerable: [
              { name: "lodash", current: "4.17.0", cves: ["CVE-2021-1"] },
              { name: "axios", current: "0.21.0", cves: ["CVE-2021-2"] },
            ],
          }),
        ],
      })
    );
    expectStatus(summaries, "deps", "critical");
  });

  it("flags warning when only outdated fires (no CVEs)", () => {
    const stale = Array.from({ length: 4 }, (_, i) => ({
      name: `pkg${i}`,
      current: "1.0.0",
      latest: "2.0.0",
      ageMonths: 14,
      lastPublished: "2025-01-01",
    }));
    const summaries = summarizeHealth(
      snap({
        dependencyHealths: [
          depHealth({ total: 30, outdated: stale }),
        ],
      })
    );
    expectStatus(summaries, "deps", "warning");
  });

  it("flags healthy when fresh-deps fires alone", () => {
    const summaries = summarizeHealth(
      snap({
        dependencyHealths: [depHealth({ total: 20 })],
      })
    );
    expectStatus(summaries, "deps", "healthy");
  });

  it("stays unknown when there's no manifest data at all", () => {
    expectStatus(summarizeHealth(snap()), "deps", "unknown");
  });
});

// ---------------- PR flow ----------------

describe("summarizeHealth · PR flow", () => {
  function pr(opts: Partial<PullRequestSummary> = {}): PullRequestSummary {
    return {
      number: Math.floor(Math.random() * 10000),
      title: "test",
      state: "closed",
      merged: true,
      authorLogin: "alice",
      createdAt: "2026-04-01T00:00:00Z",
      closedAt: "2026-04-02T00:00:00Z",
      mergedAt: "2026-04-02T00:00:00Z",
      ...opts,
    };
  }

  it("flags critical when pr-backlog severity is high (open > 3× merged)", () => {
    const prs = [
      ...Array(20).fill(null).map(() =>
        pr({ state: "open", merged: false, mergedAt: null })
      ),
      ...Array(5).fill(null).map(() => pr({ merged: true })),
    ];
    const summaries = summarizeHealth(snap({ pullRequests: prs }));
    expectStatus(summaries, "pr-flow", "critical");
  });

  it("flags healthy on healthy throughput", () => {
    const prs = [
      ...Array(10).fill(null).map(() => pr({ merged: true })),
      ...Array(3).fill(null).map(() =>
        pr({ state: "open", merged: false, mergedAt: null })
      ),
    ];
    const summaries = summarizeHealth(snap({ pullRequests: prs }));
    expectStatus(summaries, "pr-flow", "healthy");
  });

  it("stays unknown when no PR data", () => {
    expectStatus(summarizeHealth(snap()), "pr-flow", "unknown");
  });
});

// ---------------- Hygiene ----------------

describe("summarizeHealth · hygiene", () => {
  it("flags warning on missing-hygiene", () => {
    const summaries = summarizeHealth(
      snap({
        hasReadme: false,
        repo: { ...snap().repo, license: null },
      })
    );
    expectStatus(summaries, "hygiene", "warning");
  });

  it("defaults healthy when license + readme both present", () => {
    expectStatus(summarizeHealth(snap()), "hygiene", "healthy");
  });
});

// ---------------- Detail + signalCount ----------------

describe("summarizeHealth · detail and counts", () => {
  it("detail surfaces concrete numbers from the lead signal", () => {
    const summaries = summarizeHealth(
      snap({
        dependencyHealths: [
          depHealth({
            vulnerable: [
              { name: "lodash", current: "4.17.0", cves: ["CVE-1"] },
            ],
          }),
        ],
      })
    );
    const deps = findDimension(summaries, "deps");
    // shortDetail extracts the first clause from signal.detail, which
    // for vulnerable-deps starts with "X known CVE..." — concrete and
    // numbery, not the abstract title "vulnerable dependencies".
    expect(deps.detail).toContain("CVE");
  });

  it("detail trims everything after the em-dash editorial", () => {
    // bus-factor-risk detail: "X solo-owned folder(s) — high bus factor risk"
    // Expected: only the "X solo-owned folder(s)" half.
    const recent = new Date(Date.now() - 5 * 24 * 3600 * 1000).toISOString();
    const summaries = summarizeHealth(
      snap({
        hotspots: [
          { path: "auth/a.ts", churn: 10, authors: 1, authorLogins: ["alice"], lastModified: recent, score: 10, commits: [] },
          { path: "auth/b.ts", churn: 10, authors: 1, authorLogins: ["alice"], lastModified: recent, score: 10, commits: [] },
          { path: "ui/c.ts", churn: 10, authors: 3, authorLogins: ["alice", "bob", "carol"], lastModified: recent, score: 30, commits: [] },
          { path: "ui/d.ts", churn: 10, authors: 3, authorLogins: ["bob", "carol", "dave"], lastModified: recent, score: 30, commits: [] },
        ],
        recentCommits: [commit(recent, "alice"), commit(recent, "bob")],
      })
    );
    const team = findDimension(summaries, "team");
    expect(team.detail).toContain("active folder");
    expect(team.detail).not.toContain("bus factor risk");
  });

  it("signalCount tallies working + needsWork + questions for the dimension", () => {
    // Vulnerable deps + outdated deps = 2 needsWork in deps dimension.
    // (No fresh-deps because the CVE blocks it.)
    const summaries = summarizeHealth(
      snap({
        dependencyHealths: [
          depHealth({
            total: 30,
            vulnerable: [
              { name: "lodash", current: "4.17.0", cves: ["CVE-1"] },
            ],
            outdated: Array.from({ length: 4 }, (_, i) => ({
              name: `p${i}`,
              current: "1.0.0",
              latest: "2.0.0",
              ageMonths: 14,
              lastPublished: "2025-01-01",
            })),
          }),
        ],
      })
    );
    const deps = findDimension(summaries, "deps");
    expect(deps.signalCount).toBe(2);
  });
});

// ---------------- Status precedence ----------------

describe("summarizeHealth · precedence", () => {
  it("a critical signal trumps any working signal in the same dimension", () => {
    // Many contributors (working: many-contributors) AND single-owner
    // hotspots (needsWork: bus-factor-risk severity=high) → team = critical
    const contributors: Contributor[] = Array.from({ length: 25 }, (_, i) => ({
      login: `dev${i}`,
      avatarUrl: "",
      htmlUrl: "",
      contributions: 100 - i,
    }));
    const recent = new Date(Date.now() - 5 * 24 * 3600 * 1000).toISOString();
    const summaries = summarizeHealth(
      snap({
        contributors,
        // 3 single-owner folders → bus-factor-risk severity = high
        hotspots: [
          hotspot("auth/a.ts", 10, ["alice"]),
          hotspot("auth/b.ts", 10, ["alice"]),
          hotspot("api/c.ts", 10, ["bob"]),
          hotspot("api/d.ts", 10, ["bob"]),
          hotspot("ui/e.ts", 10, ["carol"]),
          hotspot("ui/f.ts", 10, ["carol"]),
        ],
        recentCommits: [
          commit(recent, "alice"),
          commit(recent, "bob"),
          commit(recent, "carol"),
        ],
      })
    );
    expectStatus(summaries, "team", "critical");
  });
});
