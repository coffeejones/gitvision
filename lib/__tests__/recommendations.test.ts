// Coverage for the recommendations engine (lib/recommendations.ts). Most tests
// drive the pure core (recommendationsFromSignals) with hand-built signals so
// each rule is exercised deterministically; a few drive generateRecommendations
// end-to-end through extractHealthSignals to confirm the wiring.

import { describe, it, expect } from "vitest";
import {
  recommendationsFromSignals,
  generateRecommendations,
  type Recommendation,
} from "../recommendations";
import type { AnalysisSnapshot, HealthSignal, HealthSignals } from "../types";

// ---- helpers ----

function sig(
  partial: Partial<HealthSignal> & { id: string }
): HealthSignal {
  return { title: "t", detail: "d", evidence: {}, ...partial };
}

function signals(over: Partial<HealthSignals>): HealthSignals {
  return { working: [], needsWork: [], questions: [], ...over };
}

function mockSnapshot(
  overrides: Partial<AnalysisSnapshot> = {}
): AnalysisSnapshot {
  return {
    fetchedAt: "2026-06-23T00:00:00Z",
    repo: {
      owner: "test",
      name: "test",
      fullName: "test/test",
      description: "Test repo",
      stars: 0,
      forks: 0,
      watchers: 0,
      openIssues: 0,
      defaultBranch: "main",
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2026-06-22T00:00:00Z",
      pushedAt: "2026-06-22T00:00:00Z",
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

// Every signal id the engine is expected to advise on (needsWork + questions).
const ACTIONABLE_IDS = [
  "known-incident-match",
  "vulnerable-deps",
  "risky-eval-patterns",
  "deprecated-deps",
  "outdated-deps",
  "untested-hotspots",
  "cross-boundary-coupling",
  "deep-dependency-chains",
  "bus-factor-risk",
  "pr-backlog",
  "slow-pr-cycle",
  "solo-project",
  "stale",
  "metadata-dominance",
  "missing-hygiene",
];

describe("coverage — every actionable signal yields a recommendation", () => {
  it("maps all actionable signal ids", () => {
    const needsWork = ACTIONABLE_IDS.slice(0, 10).map((id) =>
      sig({ id, severity: "medium" })
    );
    const questions = ACTIONABLE_IDS.slice(10).map((id) => sig({ id }));
    const recs = recommendationsFromSignals(
      signals({ needsWork, questions }),
      mockSnapshot(),
      100
    );
    const ids = recs.items.map((r) => r.signalId).sort();
    expect(ids).toEqual([...ACTIONABLE_IDS].sort());
  });

  it("produces a complete recommendation shape for each", () => {
    const recs = recommendationsFromSignals(
      signals({
        needsWork: ACTIONABLE_IDS.map((id) => sig({ id, severity: "medium" })),
      }),
      mockSnapshot(),
      100
    );
    for (const r of recs.items) {
      expect(r.title).toBeTruthy();
      expect(r.action).toBeTruthy();
      expect(r.why).toBeTruthy();
      expect(r.category).toBeTruthy();
      expect(r.effort).toBeTruthy();
      expect(typeof r.priority).toBe("number");
      expect(r.id).toBe(`rec-${r.signalId}`);
    }
  });
});

describe("working signals are ignored", () => {
  it("returns nothing for a clean repo (only positive signals)", () => {
    const recs = recommendationsFromSignals(
      signals({
        working: [
          sig({ id: "healthy-pr-throughput" }),
          sig({ id: "fresh-deps" }),
          sig({ id: "good-test-presence" }),
          sig({ id: "broad-ownership" }),
        ],
      }),
      mockSnapshot()
    );
    expect(recs.items).toHaveLength(0);
    expect(recs.topActions).toHaveLength(0);
  });

  it("ignores unknown signal ids without crashing", () => {
    const recs = recommendationsFromSignals(
      signals({ needsWork: [sig({ id: "some-future-signal" })] }),
      mockSnapshot()
    );
    expect(recs.items).toHaveLength(0);
  });
});

describe("grounding — recommendations trace back to their signal", () => {
  it("carries the signal id and its evidence verbatim", () => {
    const evidence = {
      paths: ["src/a.ts", "src/b.ts"],
      numbers: { pctUntested: 90, sampled: 10 },
    };
    const recs = recommendationsFromSignals(
      signals({ needsWork: [sig({ id: "untested-hotspots", evidence, severity: "high" })] }),
      mockSnapshot()
    );
    expect(recs.items[0].signalId).toBe("untested-hotspots");
    expect(recs.items[0].evidence).toBe(evidence);
    expect(recs.items[0].severity).toBe("high");
  });
});

describe("repo-specific copy — pulls real evidence into the prose", () => {
  it("names the untested files and percentage", () => {
    const recs = recommendationsFromSignals(
      signals({
        needsWork: [
          sig({
            id: "untested-hotspots",
            severity: "high",
            evidence: {
              paths: ["src/payments.ts", "src/auth.ts"],
              numbers: { pctUntested: 85 },
            },
          }),
        ],
      }),
      mockSnapshot()
    );
    const { action, category, effort } = recs.items[0];
    expect(action).toContain("85%");
    expect(action).toContain("src/payments.ts");
    expect(action).toContain("src/auth.ts");
    expect(category).toBe("tests");
    expect(effort).toBe("substantial");
  });

  it("names vulnerable packages and counts", () => {
    const recs = recommendationsFromSignals(
      signals({
        needsWork: [
          sig({
            id: "vulnerable-deps",
            severity: "high",
            evidence: {
              paths: ["[npm] lodash@4.17.11 · CVE-2019-10744"],
              numbers: { packages: 3, cves: 5 },
            },
          }),
        ],
      }),
      mockSnapshot()
    );
    const { action, category } = recs.items[0];
    expect(action).toContain("3");
    expect(action).toContain("5");
    expect(action).toContain("lodash");
    expect(category).toBe("security");
  });

  it("names the single contributor on solo-project", () => {
    const recs = recommendationsFromSignals(
      signals({ questions: [sig({ id: "solo-project", evidence: { note: "octocat" } })] }),
      mockSnapshot()
    );
    expect(recs.items[0].action).toContain("@octocat");
  });

  it("uses the missing-hygiene note in title and action", () => {
    const recs = recommendationsFromSignals(
      signals({ questions: [sig({ id: "missing-hygiene", evidence: { note: "LICENSE, README" } })] }),
      mockSnapshot()
    );
    expect(recs.items[0].title).toContain("LICENSE, README");
    expect(recs.items[0].action).toContain("LICENSE, README");
    expect(recs.items[0].category).toBe("docs");
  });
});

describe("prioritization", () => {
  it("ranks high-severity security above medium process above soft questions", () => {
    const recs = recommendationsFromSignals(
      signals({
        needsWork: [
          sig({ id: "pr-backlog", severity: "medium" }),
          sig({ id: "vulnerable-deps", severity: "high" }),
        ],
        questions: [sig({ id: "solo-project" })],
      }),
      mockSnapshot()
    );
    expect(recs.items.map((r) => r.signalId)).toEqual([
      "vulnerable-deps",
      "pr-backlog",
      "solo-project",
    ]);
    // priority strictly decreasing
    for (let i = 1; i < recs.items.length; i++) {
      expect(recs.items[i - 1].priority).toBeGreaterThan(recs.items[i].priority);
    }
  });

  it("breaks ties on signalId for deterministic output", () => {
    // pr-backlog and slow-pr-cycle share category weight; same severity → tie.
    const recs = recommendationsFromSignals(
      signals({
        needsWork: [
          sig({ id: "slow-pr-cycle", severity: "medium" }),
          sig({ id: "pr-backlog", severity: "medium" }),
        ],
      }),
      mockSnapshot()
    );
    expect(recs.items[0].priority).toBe(recs.items[1].priority);
    expect(recs.items.map((r) => r.signalId)).toEqual([
      "pr-backlog",
      "slow-pr-cycle",
    ]);
  });

  it("a known-incident match outranks a generic vulnerable-deps (both high)", () => {
    const recs = recommendationsFromSignals(
      signals({
        needsWork: [
          sig({ id: "vulnerable-deps", severity: "high" }),
          sig({ id: "known-incident-match", severity: "high" }),
        ],
      }),
      mockSnapshot()
    );
    expect(recs.items[0].signalId).toBe("known-incident-match");
  });

  it("any real (needsWork) issue outranks any soft (questions) nudge", () => {
    const recs = recommendationsFromSignals(
      signals({
        needsWork: [sig({ id: "stale", severity: "low" })],
        questions: [sig({ id: "missing-hygiene" }), sig({ id: "metadata-dominance" })],
      }),
      mockSnapshot()
    );
    expect(recs.items[0].signalId).toBe("stale");
  });
});

describe("topActions shortlist", () => {
  it("returns the highest-priority N, leaving items complete", () => {
    const needsWork = [
      sig({ id: "vulnerable-deps", severity: "high" }),
      sig({ id: "untested-hotspots", severity: "high" }),
      sig({ id: "pr-backlog", severity: "medium" }),
      sig({ id: "stale", severity: "low" }),
    ];
    const recs = recommendationsFromSignals(signals({ needsWork }), mockSnapshot(), 2);
    expect(recs.items).toHaveLength(4);
    expect(recs.topActions).toHaveLength(2);
    expect(recs.topActions[0].signalId).toBe("vulnerable-deps");
  });

  it("topN=0 yields no shortlist but keeps all items", () => {
    const recs = recommendationsFromSignals(
      signals({ needsWork: [sig({ id: "stale", severity: "medium" })] }),
      mockSnapshot(),
      0
    );
    expect(recs.topActions).toHaveLength(0);
    expect(recs.items).toHaveLength(1);
  });
});

describe("defensive — thin or missing evidence never crashes", () => {
  it("produces a sensible string even with empty evidence", () => {
    for (const id of ACTIONABLE_IDS) {
      const recs = recommendationsFromSignals(
        signals({ needsWork: [sig({ id, severity: "medium" })] }),
        mockSnapshot()
      );
      expect(recs.items).toHaveLength(1);
      expect(typeof recs.items[0].action).toBe("string");
      expect(recs.items[0].action.length).toBeGreaterThan(0);
      expect(recs.items[0].action).not.toContain("undefined");
      expect(recs.items[0].action).not.toContain("NaN");
      expect(Number.isFinite(recs.items[0].priority)).toBe(true);
    }
  });
});

// Regression locks for the issues the adversarial review surfaced — copy
// accuracy, grounding fidelity, and singular/plural agreement at count = 1.
describe("review fixes — accuracy + grounding + agreement", () => {
  function only(signal: HealthSignal) {
    return recommendationsFromSignals(
      signals({ needsWork: [signal] }),
      mockSnapshot()
    ).items[0];
  }

  it("deep-dependency-chains advises split / dependency-inversion, not hoisting to root", () => {
    const r = only(
      sig({
        id: "deep-dependency-chains",
        severity: "high",
        evidence: { paths: ["a.ts", "z.ts"], numbers: { maxDepth: 12 } },
      })
    );
    expect(r.action).not.toContain("up toward the root");
    expect(r.action).toContain("split");
    expect(r.action).toContain("invert a dependency");
    expect(r.action).toContain("god-module");
    // The "why" describes ripple toward importers, not "every level below".
    expect(r.why).toContain("transitively imports it");
    expect(r.why).not.toContain("every level below");
  });

  it("vulnerable-deps why drops the ungrounded superlative and app/library conflation", () => {
    const r = only(sig({ id: "vulnerable-deps", severity: "high" }));
    expect(r.why).not.toContain("most directly exploitable risk");
    expect(r.why).not.toContain("ship to everyone");
    expect(r.why).toContain("upper bound on risk");
  });

  it("vulnerable-deps reads correctly with a single package + single CVE", () => {
    const r = only(
      sig({
        id: "vulnerable-deps",
        severity: "high",
        evidence: { numbers: { packages: 1, cves: 1 } },
      })
    );
    expect(r.action).toContain("1 runtime dependency has a known CVE");
    expect(r.action).toContain("Upgrade it first");
    expect(r.action).not.toContain("(1 in total)");
    expect(r.action).not.toContain("has known CVEs");
  });

  it("vulnerable-deps keeps the CVE total only when it exceeds the package count", () => {
    const r = only(
      sig({
        id: "vulnerable-deps",
        severity: "high",
        evidence: { numbers: { packages: 2, cves: 5 } },
      })
    );
    expect(r.action).toContain("have known CVEs (5 in total)");
  });

  it("known-incident-match why does not assert confirmed compromise", () => {
    const r = only(sig({ id: "known-incident-match", severity: "high" }));
    expect(r.why).not.toContain("were compromised in real attacks");
    expect(r.why).toContain("if one is confirmed");
    expect(r.why.toLowerCase()).toContain("version string");
  });

  it("deprecated-deps says runtime, agrees at count=1, and drops the plural possessive", () => {
    const r = only(
      sig({ id: "deprecated-deps", severity: "medium", evidence: { numbers: { count: 1 } } })
    );
    expect(r.action).toContain("1 runtime dependency is explicitly flagged as deprecated");
    expect(r.action).not.toContain("their maintainers");
  });

  it("outdated-deps says runtime and isolates major bumps rather than batching all", () => {
    const r = only(
      sig({ id: "outdated-deps", severity: "medium", evidence: { numbers: { behind: 7 } } })
    );
    expect(r.action).toContain("7 runtime packages");
    expect(r.action).toContain("major-version jump its own PR");
    expect(r.action).not.toContain("Batch them into a dedicated upgrade PR");
  });

  it("slow-pr-cycle renders whole days, matching the signal's humanized phrasing", () => {
    const r = only(
      sig({ id: "slow-pr-cycle", severity: "medium", evidence: { numbers: { medianDays: 14.6 } } })
    );
    expect(r.action).toContain("median of 15 days");
    expect(r.action).not.toContain("14.6");
  });
});

describe("generateRecommendations — end-to-end through extractHealthSignals", () => {
  it("derives a docs recommendation from a license/README-less repo", () => {
    const recs = generateRecommendations(
      mockSnapshot({
        repo: { ...mockSnapshot().repo, license: null },
        hasReadme: false,
      })
    );
    const hygiene = recs.items.find((r) => r.signalId === "missing-hygiene");
    expect(hygiene).toBeDefined();
    expect(hygiene?.category).toBe("docs");
  });

  it("returns nothing for a healthy default snapshot", () => {
    const recs = generateRecommendations(mockSnapshot());
    expect(recs.items).toHaveLength(0);
  });
});
