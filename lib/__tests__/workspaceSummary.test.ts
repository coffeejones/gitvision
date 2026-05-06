// Tests for the workspace dashboard logic (v0.68 / C3).
//
// Two pure functions to verify:
//   - sortWorkspaceByPriority — most-critical-first ordering
//   - computeHealthTrend — last-N-statuses sequence per dimension
//
// We don't unit-test getWorkspaceSummary / getWorkspaceSummaries
// directly because they hit disk via lib/storage. Coverage of the
// shape they project is implicit through sortWorkspaceByPriority's
// fixtures (which pass synthesized WorkspaceSummary[] in).

import { describe, it, expect } from "vitest";
import {
  sortWorkspaceByPriority,
  type WorkspaceSummary,
} from "../intelligence/workspaceSummary";
import {
  computeHealthTrend,
  DEFAULT_TREND_WINDOW,
  type DimensionStatus,
  type DimensionSummary,
} from "../intelligence/healthSummary";
import type {
  AnalysisSnapshot,
  Contributor,
  DependencyHealth,
} from "../types";
import type { Headline } from "../intelligence/headline";

// ---------------- Workspace fixture builders ----------------

function dimSummary(
  id: DimensionSummary["id"],
  status: DimensionStatus
): DimensionSummary {
  return {
    id,
    label: id,
    status,
    statusLabel: status,
    signalCount: 0,
  };
}

function mkWorkspaceSummary(
  overrides: Partial<WorkspaceSummary> & { id: string }
): WorkspaceSummary {
  return {
    name: overrides.id,
    repoFullName: `acme/${overrides.id}`,
    updatedAt: "2026-05-06T00:00:00Z",
    snapshotCount: 1,
    dimensions: [
      dimSummary("activity", "healthy"),
      dimSummary("team", "healthy"),
      dimSummary("code", "healthy"),
      dimSummary("pr-flow", "healthy"),
      dimSummary("deps", "healthy"),
      dimSummary("hygiene", "healthy"),
    ],
    headline: {
      kind: "generic-healthy",
      severity: "info",
      primary: "Looks healthy",
      detail: "no concerns",
    } as Headline,
    criticalCount: 0,
    ...overrides,
  };
}

// ---------------- sortWorkspaceByPriority ----------------

describe("sortWorkspaceByPriority", () => {
  it("ranks higher criticalCount first", () => {
    const summaries = [
      mkWorkspaceSummary({ id: "a", criticalCount: 0 }),
      mkWorkspaceSummary({ id: "b", criticalCount: 3 }),
      mkWorkspaceSummary({ id: "c", criticalCount: 1 }),
    ];
    const ranked = sortWorkspaceByPriority(summaries);
    expect(ranked.map((s) => s.id)).toEqual(["b", "c", "a"]);
  });

  it("breaks criticalCount ties by warning-dimension count", () => {
    const summaries = [
      mkWorkspaceSummary({
        id: "a",
        criticalCount: 0,
        dimensions: [
          dimSummary("code", "warning"),
          dimSummary("activity", "healthy"),
          dimSummary("team", "healthy"),
          dimSummary("pr-flow", "healthy"),
          dimSummary("deps", "healthy"),
          dimSummary("hygiene", "healthy"),
        ],
      }),
      mkWorkspaceSummary({
        id: "b",
        criticalCount: 0,
        dimensions: [
          dimSummary("code", "warning"),
          dimSummary("activity", "warning"),
          dimSummary("team", "warning"),
          dimSummary("pr-flow", "healthy"),
          dimSummary("deps", "healthy"),
          dimSummary("hygiene", "healthy"),
        ],
      }),
    ];
    const ranked = sortWorkspaceByPriority(summaries);
    expect(ranked[0].id).toBe("b"); // 3 warnings beats 1 warning
  });

  it("breaks remaining ties by updatedAt desc", () => {
    const summaries = [
      mkWorkspaceSummary({
        id: "old",
        criticalCount: 0,
        updatedAt: "2026-05-01T00:00:00Z",
      }),
      mkWorkspaceSummary({
        id: "new",
        criticalCount: 0,
        updatedAt: "2026-05-06T00:00:00Z",
      }),
    ];
    const ranked = sortWorkspaceByPriority(summaries);
    expect(ranked[0].id).toBe("new");
  });

  it("does not mutate the input array", () => {
    const summaries = [
      mkWorkspaceSummary({ id: "low", criticalCount: 0 }),
      mkWorkspaceSummary({ id: "high", criticalCount: 5 }),
    ];
    const original = [...summaries];
    sortWorkspaceByPriority(summaries);
    expect(summaries.map((s) => s.id)).toEqual(original.map((s) => s.id));
  });
});

// ---------------- computeHealthTrend ----------------

describe("computeHealthTrend", () => {
  /** Build a minimal snapshot whose dimensions resolve to specific
   *  health statuses. We exploit the existing summarizeHealth detector
   *  paths: a recent commit + many contributors gives healthy on
   *  activity + team. We don't try to hit every status — the trend
   *  function just sequences whatever summarizeHealth returns. */
  function snap(
    fetchedAt: string,
    overrides: Partial<AnalysisSnapshot> = {}
  ): AnalysisSnapshot {
    return {
      fetchedAt,
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
        updatedAt: fetchedAt,
        // Pin pushedAt to a stable date well inside the
        // detectActivityRecency window so "very-active" reliably
        // fires for these fixtures.
        pushedAt: new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString(),
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

  it("returns one series per dimension, oldest-first", () => {
    const snapshots = [snap("2026-01-01"), snap("2026-02-01"), snap("2026-03-01")];
    const trend = computeHealthTrend(snapshots);
    // Six canonical dimensions
    expect(trend.size).toBe(6);
    for (const series of trend.values()) {
      expect(series).toHaveLength(3);
    }
  });

  it("respects the window (default 5)", () => {
    const snapshots = Array.from({ length: 8 }, (_, i) =>
      snap(`2026-0${i + 1}-01`)
    );
    const trend = computeHealthTrend(snapshots);
    for (const series of trend.values()) {
      expect(series).toHaveLength(DEFAULT_TREND_WINDOW);
    }
  });

  it("accepts a custom window size", () => {
    const snapshots = Array.from({ length: 10 }, (_, i) =>
      snap(`2026-0${i + 1}-01`)
    );
    const trend = computeHealthTrend(snapshots, 3);
    for (const series of trend.values()) {
      expect(series).toHaveLength(3);
    }
  });

  it("returns empty Map on empty input", () => {
    const trend = computeHealthTrend([]);
    expect(trend.size).toBe(0);
  });

  it("captures a status change across snapshots", () => {
    // First snapshot: deps healthy (no manifests = unknown actually,
    // but with deps array empty + total=0, no signals fire). Second
    // snapshot: vulnerable-deps fires → critical.
    const cleanSnap = snap("2026-01-01");
    const vulnSnap = snap("2026-02-01", {
      dependencyHealths: [
        {
          ecosystem: "npm",
          total: 10,
          outdated: [],
          vulnerable: [
            { name: "lodash", current: "4.17.0", cves: ["CVE-1"] },
          ],
          deprecated: [],
          analyzedAt: "2026-02-01",
        },
      ] as DependencyHealth[],
    });
    const trend = computeHealthTrend([cleanSnap, vulnSnap]);
    const depsSeries = trend.get("deps");
    expect(depsSeries).toBeDefined();
    // First was unknown (no manifests at all); second is critical
    // (vulnerable-deps fires).
    expect(depsSeries![0]).toBe("unknown");
    expect(depsSeries![1]).toBe("critical");
  });

  it("preserves canonical dimension order in the keys", () => {
    const snapshots = [snap("2026-01-01")];
    const trend = computeHealthTrend(snapshots);
    expect([...trend.keys()]).toEqual([
      "activity",
      "team",
      "code",
      "pr-flow",
      "deps",
      "hygiene",
    ]);
  });
});
