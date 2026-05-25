// Tests for the signal engine. Many detectors — we test via the public
// extractHealthSignals() so we exercise the real aggregation + gating logic.

import { describe, it, expect } from "vitest";
import { extractHealthSignals } from "../signals";
import type {
  AnalysisSnapshot,
  FileGraph,
  FileHotspot,
  PullRequestSummary,
  DependencyHealth,
} from "../types";

// ------------------- Mock factory -------------------

function mockSnapshot(overrides: Partial<AnalysisSnapshot> = {}): AnalysisSnapshot {
  return {
    fetchedAt: "2026-04-23T00:00:00Z",
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
      updatedAt: "2026-04-22T00:00:00Z",
      pushedAt: "2026-04-22T00:00:00Z",
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

function hotspot(
  path: string,
  churn: number,
  authorLogins: string[] = ["alice"],
  opts: Partial<FileHotspot> = {}
): FileHotspot {
  return {
    path,
    churn,
    authors: authorLogins.length,
    authorLogins,
    lastModified: "2026-04-22T00:00:00Z",
    score: churn * Math.log(authorLogins.length + 1),
    commits: [],
    ...opts,
  };
}

function pr(opts: Partial<PullRequestSummary> = {}): PullRequestSummary {
  return {
    number: 1,
    title: "test PR",
    state: "closed",
    merged: true,
    authorLogin: "alice",
    createdAt: "2026-04-01T00:00:00Z",
    closedAt: "2026-04-02T00:00:00Z",
    mergedAt: "2026-04-02T00:00:00Z",
    ...opts,
  };
}

const hasSignal = (sig: { id: string }[], id: string) =>
  sig.some((s) => s.id === id);

// ------------------- PR throughput & cycle time -------------------

describe("PR throughput signals", () => {
  it("fires backlog when human-authored open > 1.5× merged", () => {
    const prs = [
      ...Array(15).fill(null).map((_, i) => pr({ number: i, state: "open", merged: false, mergedAt: null })),
      ...Array(5).fill(null).map((_, i) => pr({ number: 100 + i, merged: true })),
    ];
    const { needsWork } = extractHealthSignals(mockSnapshot({ pullRequests: prs }));
    expect(hasSignal(needsWork, "pr-backlog")).toBe(true);
  });

  it("fires healthy-throughput when merged ≥ open", () => {
    const prs = [
      ...Array(10).fill(null).map((_, i) => pr({ number: i, merged: true })),
      ...Array(5).fill(null).map((_, i) => pr({ number: 100 + i, state: "open", merged: false, mergedAt: null })),
    ];
    const { working } = extractHealthSignals(mockSnapshot({ pullRequests: prs }));
    expect(hasSignal(working, "healthy-pr-throughput")).toBe(true);
  });

  it("filters out bot-authored PRs", () => {
    // Lots of dependabot PRs should NOT inflate throughput signal
    const prs = [
      ...Array(20).fill(null).map((_, i) => pr({ number: i, merged: true, authorLogin: "dependabot[bot]" })),
      // Only 6 human PRs, 5 open
      ...Array(1).fill(null).map((_, i) => pr({ number: 500 + i, merged: true, authorLogin: "alice" })),
      ...Array(5).fill(null).map((_, i) => pr({ number: 600 + i, state: "open", merged: false, mergedAt: null, authorLogin: "alice" })),
    ];
    // 1 merged vs 5 open among humans — should fire backlog
    const { needsWork, working } = extractHealthSignals(mockSnapshot({ pullRequests: prs }));
    expect(hasSignal(needsWork, "pr-backlog")).toBe(true);
    expect(hasSignal(working, "healthy-pr-throughput")).toBe(false);
  });

  it("fast PR cycle fires on sub-3-day median", () => {
    const prs = Array.from({ length: 10 }, (_, i) =>
      pr({
        number: i,
        createdAt: "2026-04-01T00:00:00Z",
        mergedAt: "2026-04-01T12:00:00Z", // 12h → 0.5 days
      })
    );
    const { working } = extractHealthSignals(mockSnapshot({ pullRequests: prs }));
    expect(hasSignal(working, "fast-pr-cycle")).toBe(true);
  });

  it("slow PR cycle fires on ≥14-day median", () => {
    const prs = Array.from({ length: 10 }, (_, i) =>
      pr({
        number: i,
        createdAt: "2026-04-01T00:00:00Z",
        mergedAt: "2026-04-20T00:00:00Z", // 19 days
      })
    );
    const { needsWork } = extractHealthSignals(mockSnapshot({ pullRequests: prs }));
    expect(hasSignal(needsWork, "slow-pr-cycle")).toBe(true);
  });
});

// ------------------- Knowledge distribution -------------------

describe("Knowledge distribution signals", () => {
  it("fires bus-factor-risk on single-owner folders", () => {
    const hotspots = [
      hotspot("src/auth/foo.ts", 10, ["alice"]),
      hotspot("src/auth/bar.ts", 10, ["alice"]),
      hotspot("web/page.ts", 10, ["alice", "bob", "carol"]),
      hotspot("web/other.ts", 10, ["bob", "carol", "dave"]),
    ];
    const { needsWork } = extractHealthSignals(
      mockSnapshot({
        hotspots,
        recentCommits: [
          { sha: "a", message: "x", authorLogin: "alice", authorName: "a", authorEmail: "", date: "2026-04-22" },
          { sha: "b", message: "y", authorLogin: "bob", authorName: "b", authorEmail: "", date: "2026-04-22" },
        ],
      })
    );
    expect(hasSignal(needsWork, "bus-factor-risk")).toBe(true);
  });

  it("suppresses bus-factor-risk when it's a solo project", () => {
    const hotspots = [
      hotspot("src/auth/foo.ts", 10, ["solo"]),
      hotspot("web/page.ts", 10, ["solo"]),
    ];
    const { needsWork, questions } = extractHealthSignals(
      mockSnapshot({
        hotspots,
        recentCommits: Array(10).fill(null).map((_, i) => ({
          sha: `c${i}`,
          message: "",
          authorLogin: "solo",
          authorName: "solo",
          authorEmail: "",
          date: "2026-04-22",
        })),
      })
    );
    expect(hasSignal(questions, "solo-project")).toBe(true);
    expect(hasSignal(needsWork, "bus-factor-risk")).toBe(false);
  });

  it("fires broad-ownership when 3+ folders have 3+ authors", () => {
    const hotspots = [
      hotspot("a/f.ts", 10, ["x", "y", "z"]),
      hotspot("b/f.ts", 10, ["x", "y", "z"]),
      hotspot("c/f.ts", 10, ["x", "y", "z"]),
    ];
    const { working } = extractHealthSignals(mockSnapshot({ hotspots }));
    expect(hasSignal(working, "broad-ownership")).toBe(true);
  });
});

// ------------------- Cross-boundary coupling -------------------

describe("Cross-boundary coupling", () => {
  it("fires on cross-folder pairs", () => {
    const { needsWork } = extractHealthSignals(
      mockSnapshot({
        coChange: [
          { from: "src/a.ts", to: "lib/b.ts", count: 5 },
          { from: "src/c.ts", to: "lib/d.ts", count: 4 },
          { from: "src/e.ts", to: "lib/f.ts", count: 3 },
        ],
      })
    );
    expect(hasSignal(needsWork, "cross-boundary-coupling")).toBe(true);
  });

  it("ignores source-output folder pairs (scripts → docs)", () => {
    const { needsWork } = extractHealthSignals(
      mockSnapshot({
        coChange: [
          { from: "scripts/build.js", to: "docs/out.html", count: 10 },
          { from: "scripts/pipeline.sh", to: "docs/index.html", count: 8 },
          { from: "src/gen.ts", to: "dist/bundle.js", count: 6 },
        ],
      })
    );
    // All three pairs involve output-like folders — should not flag
    expect(hasSignal(needsWork, "cross-boundary-coupling")).toBe(false);
  });
});

// ------------------- Hygiene -------------------

describe("Missing hygiene", () => {
  it("flags missing LICENSE", () => {
    const snap = mockSnapshot({
      repo: { ...mockSnapshot().repo, license: null },
    });
    const { questions } = extractHealthSignals(snap);
    expect(hasSignal(questions, "missing-hygiene")).toBe(true);
  });

  it("flags missing README when hasReadme is false", () => {
    const snap = mockSnapshot({ hasReadme: false });
    const { questions } = extractHealthSignals(snap);
    expect(hasSignal(questions, "missing-hygiene")).toBe(true);
  });

  it("does NOT flag README when hasReadme undefined (old snapshot)", () => {
    const snap = mockSnapshot({ hasReadme: undefined });
    const { questions } = extractHealthSignals(snap);
    // should not cry wolf on pre-v0.6 snapshots that lack the flag
    const mentionsReadme = questions.some(
      (s) => s.id === "missing-hygiene" && s.detail.includes("README")
    );
    expect(mentionsReadme).toBe(false);
  });

  it("silent when both are present", () => {
    const { questions } = extractHealthSignals(mockSnapshot()); // defaults: license=MIT, hasReadme=true
    expect(hasSignal(questions, "missing-hygiene")).toBe(false);
  });
});

// ------------------- Activity recency -------------------

describe("Activity recency", () => {
  it("fires very-active when last commit < 7 days", () => {
    const snap = mockSnapshot({
      recentCommits: [
        {
          sha: "a",
          message: "x",
          authorLogin: "alice",
          authorName: "alice",
          authorEmail: "",
          date: new Date(Date.now() - 2 * 24 * 3600_000).toISOString(),
        },
      ],
    });
    const { working } = extractHealthSignals(snap);
    expect(hasSignal(working, "very-active")).toBe(true);
  });

  it("fires stale when last commit > 90 days", () => {
    const snap = mockSnapshot({
      recentCommits: [
        {
          sha: "a",
          message: "x",
          authorLogin: "alice",
          authorName: "alice",
          authorEmail: "",
          date: new Date(Date.now() - 120 * 24 * 3600_000).toISOString(),
        },
      ],
    });
    const { needsWork } = extractHealthSignals(snap);
    expect(hasSignal(needsWork, "stale")).toBe(true);
  });
});

// ------------------- Dependency-health signals -------------------

describe("Dependency-health signals", () => {
  function depHealth(overrides: Partial<DependencyHealth> = {}): DependencyHealth {
    return {
      ecosystem: "npm",
      total: 20,
      outdated: [],
      vulnerable: [],
      deprecated: [],
      analyzedAt: "2026-04-23T00:00:00Z",
      ...overrides,
    };
  }

  it("vulnerable-deps is HIGH severity", () => {
    const { needsWork } = extractHealthSignals(
      mockSnapshot({
        dependencyHealth: depHealth({
          vulnerable: [{ name: "badpkg", current: "1.0.0", cves: ["CVE-2024-123"] }],
        }),
      })
    );
    const signal = needsWork.find((s) => s.id === "vulnerable-deps");
    expect(signal).toBeDefined();
    expect(signal?.severity).toBe("high");
  });

  it("outdated-deps fires only at ≥3 packages ≥1 year behind", () => {
    const { needsWork: under } = extractHealthSignals(
      mockSnapshot({
        dependencyHealth: depHealth({
          outdated: [
            { name: "a", current: "1.0", latest: "2.0", ageMonths: 14, lastPublished: "2026-01-01" },
            { name: "b", current: "1.0", latest: "2.0", ageMonths: 13, lastPublished: "2026-01-01" },
          ],
        }),
      })
    );
    expect(hasSignal(under, "outdated-deps")).toBe(false);

    const { needsWork: over } = extractHealthSignals(
      mockSnapshot({
        dependencyHealth: depHealth({
          outdated: Array(4).fill(null).map((_, i) => ({
            name: `pkg${i}`,
            current: "1.0",
            latest: "2.0",
            ageMonths: 14,
            lastPublished: "2026-01-01",
          })),
        }),
      })
    );
    expect(hasSignal(over, "outdated-deps")).toBe(true);
  });

  it("ignores outdated packages <12 months behind", () => {
    const { needsWork } = extractHealthSignals(
      mockSnapshot({
        dependencyHealth: depHealth({
          outdated: Array(5).fill(null).map((_, i) => ({
            name: `pkg${i}`,
            current: "1.0",
            latest: "1.1",
            ageMonths: 8, // below 12-month threshold
            lastPublished: "2026-01-01",
          })),
        }),
      })
    );
    expect(hasSignal(needsWork, "outdated-deps")).toBe(false);
  });

  it("deprecated-deps fires on any deprecated packages", () => {
    const { needsWork } = extractHealthSignals(
      mockSnapshot({
        dependencyHealth: depHealth({
          deprecated: [
            { name: "oldpkg", current: "1.0", message: "replaced by newpkg" },
          ],
        }),
      })
    );
    expect(hasSignal(needsWork, "deprecated-deps")).toBe(true);
  });

  it("fresh-deps fires on clean repo", () => {
    const { working } = extractHealthSignals(
      mockSnapshot({
        dependencyHealth: depHealth({ total: 20 }),
      })
    );
    expect(hasSignal(working, "fresh-deps")).toBe(true);
  });

  it("fresh-deps suppressed when any CVE exists", () => {
    const { working } = extractHealthSignals(
      mockSnapshot({
        dependencyHealth: depHealth({
          vulnerable: [{ name: "x", current: "1.0", cves: ["CVE-1"] }],
        }),
      })
    );
    expect(hasSignal(working, "fresh-deps")).toBe(false);
  });

  it("no dep signals when dependencyHealth is absent", () => {
    const result = extractHealthSignals(mockSnapshot());
    const all = [...result.working, ...result.needsWork, ...result.questions];
    expect(all.some((s) => s.id.includes("deps") || s.id.includes("vulnerable"))).toBe(false);
  });
});

// ------------------- Deep dependency chains -------------------

/** Build a linear fileGraph: file0 → file1 → file2 → ... → fileN,
 *  where each edge means "fileK imports fileK+1". `layers=N` produces
 *  a chain of length N+1 nodes, with max layer = N. Used by the
 *  deep-dependency-chains tests to drive the detector with a known
 *  exact depth. */
function makeLinearGraph(layers: number): FileGraph {
  const nodes = [];
  const edges = [];
  for (let i = 0; i <= layers; i++) {
    nodes.push({
      path: `file${i}.ts`,
      ext: "ts",
      layer: i,
      inDegree: i === 0 ? 0 : 1,
      outDegree: i === layers ? 0 : 1,
      x: 0,
      y: 0,
    });
    if (i > 0) {
      edges.push({
        from: `file${i - 1}.ts`,
        to: `file${i}.ts`,
        kind: "import" as const,
      });
    }
  }
  return {
    nodes,
    edges,
    stats: {
      totalFiles: layers + 1,
      filesByLanguage: { ts: layers + 1 },
      edgesByKind: { import: layers },
      skipped: 0,
    },
  };
}

describe("Deep dependency chains signal", () => {
  it("no signal when fileGraph is absent", () => {
    const { needsWork, questions } = extractHealthSignals(mockSnapshot());
    expect(hasSignal(needsWork, "deep-dependency-chains")).toBe(false);
    expect(hasSignal(questions, "deep-dependency-chains")).toBe(false);
  });

  it("no signal for shallow tree (max layer 3)", () => {
    const fileGraph = makeLinearGraph(3);
    const { needsWork, questions } = extractHealthSignals(
      mockSnapshot({ fileGraph })
    );
    expect(hasSignal(needsWork, "deep-dependency-chains")).toBe(false);
    expect(hasSignal(questions, "deep-dependency-chains")).toBe(false);
  });

  it("buckets medium depth (layer 7) into questions without severity", () => {
    const fileGraph = makeLinearGraph(7);
    const { questions } = extractHealthSignals(mockSnapshot({ fileGraph }));
    const sig = questions.find((s) => s.id === "deep-dependency-chains");
    expect(sig).toBeDefined();
    expect(sig?.severity).toBeUndefined();
    expect(sig?.evidence.numbers?.maxDepth).toBe(7);
    expect(sig?.title).toBe("Deep import chains");
  });

  it("buckets deep tree (layer 10) into needsWork with medium severity", () => {
    const fileGraph = makeLinearGraph(10);
    const { needsWork } = extractHealthSignals(mockSnapshot({ fileGraph }));
    const sig = needsWork.find((s) => s.id === "deep-dependency-chains");
    expect(sig).toBeDefined();
    expect(sig?.severity).toBe("medium");
  });

  it("buckets very deep tree (layer 15) into needsWork with high severity + 'Very deep' title", () => {
    const fileGraph = makeLinearGraph(15);
    const { needsWork } = extractHealthSignals(mockSnapshot({ fileGraph }));
    const sig = needsWork.find((s) => s.id === "deep-dependency-chains");
    expect(sig).toBeDefined();
    expect(sig?.severity).toBe("high");
    expect(sig?.title).toBe("Very deep import chains");
  });

  it("reconstructs the full chain from root to deepest node", () => {
    const fileGraph = makeLinearGraph(8);
    const { questions } = extractHealthSignals(mockSnapshot({ fileGraph }));
    const sig = questions.find((s) => s.id === "deep-dependency-chains");
    expect(sig?.evidence.paths).toEqual([
      "file0.ts",
      "file1.ts",
      "file2.ts",
      "file3.ts",
      "file4.ts",
      "file5.ts",
      "file6.ts",
      "file7.ts",
      "file8.ts",
    ]);
  });
});

// ------------------- Known-incident matching (signal #19) -------------

/** Local DependencyHealth factory mirroring the one used by the
 *  dep-health tests above. Hoisted out of that describe block so the
 *  known-incident tests can use it without depending on test ordering. */
function depHealthForIncident(
  overrides: Partial<DependencyHealth> = {},
): DependencyHealth {
  return {
    ecosystem: "npm",
    total: 5,
    outdated: [],
    vulnerable: [],
    deprecated: [],
    analyzedAt: "2026-04-23T00:00:00Z",
    ...overrides,
  };
}

describe("Known-incident signal (#19)", () => {
  it("no signal when no dependency-health is present", () => {
    const { needsWork } = extractHealthSignals(mockSnapshot());
    expect(hasSignal(needsWork, "known-incident-match")).toBe(false);
  });

  it("no signal when all package versions are safe", () => {
    const { needsWork } = extractHealthSignals(
      mockSnapshot({
        dependencyHealth: depHealthForIncident({
          outdated: [
            {
              name: "eslint-config-prettier",
              current: "9.0.0",
              latest: "10.0.0",
              ageMonths: 12,
              lastPublished: "2024-01-01T00:00:00Z",
            },
          ],
        }),
      }),
    );
    expect(hasSignal(needsWork, "known-incident-match")).toBe(false);
  });

  it("flags an exact match in outdated list (eslint-config-prettier 10.1.7)", () => {
    const { needsWork } = extractHealthSignals(
      mockSnapshot({
        dependencyHealth: depHealthForIncident({
          outdated: [
            {
              name: "eslint-config-prettier",
              current: "10.1.7",
              latest: "10.2.0",
              ageMonths: 1,
              lastPublished: "2024-08-01T00:00:00Z",
            },
          ],
        }),
      }),
    );
    const sig = needsWork.find((s) => s.id === "known-incident-match");
    expect(sig).toBeDefined();
    expect(sig?.severity).toBe("high");
    expect(sig?.evidence.paths).toContain(
      "[npm] eslint-config-prettier@10.1.7",
    );
    expect(sig?.evidence.numbers?.incidents).toBe(1);
    expect(sig?.evidence.numbers?.packages).toBe(1);
  });

  it("matches a compromised version embedded in a prefix string (==1.95.6)", () => {
    const { needsWork } = extractHealthSignals(
      mockSnapshot({
        dependencyHealth: depHealthForIncident({
          vulnerable: [
            {
              name: "@solana/web3.js",
              current: "==1.95.6",
              cves: ["GHSA-89mq-rj47-mfm9"],
            },
          ],
        }),
      }),
    );
    const sig = needsWork.find((s) => s.id === "known-incident-match");
    expect(sig).toBeDefined();
    expect(sig?.evidence.paths).toContain(
      "[npm] @solana/web3.js@==1.95.6",
    );
  });

  it("aggregates multiple incident matches into a single signal", () => {
    const { needsWork } = extractHealthSignals(
      mockSnapshot({
        dependencyHealth: depHealthForIncident({
          outdated: [
            {
              name: "colors",
              current: "1.4.1",
              latest: "1.5.0",
              ageMonths: 36,
              lastPublished: "2022-01-01T00:00:00Z",
            },
            {
              name: "faker",
              current: "6.6.6",
              latest: "8.0.0",
              ageMonths: 36,
              lastPublished: "2022-01-01T00:00:00Z",
            },
            {
              name: "@solana/web3.js",
              current: "1.95.7",
              latest: "2.0.0",
              ageMonths: 6,
              lastPublished: "2024-12-01T00:00:00Z",
            },
          ],
        }),
      }),
    );
    const sig = needsWork.find((s) => s.id === "known-incident-match");
    expect(sig).toBeDefined();
    // colors + faker are one incident (colors-faker-sabotage-2022),
    // solana is another → 2 incidents, 3 packages total.
    expect(sig?.evidence.numbers?.incidents).toBe(2);
    expect(sig?.evidence.numbers?.packages).toBe(3);
  });

  it("does not match when ecosystem differs (npm name on pypi)", () => {
    const { needsWork } = extractHealthSignals(
      mockSnapshot({
        dependencyHealth: depHealthForIncident({
          ecosystem: "pypi",
          outdated: [
            {
              name: "eslint-config-prettier",
              current: "10.1.7",
              latest: "10.2.0",
              ageMonths: 1,
              lastPublished: "2024-08-01T00:00:00Z",
            },
          ],
        }),
      }),
    );
    expect(hasSignal(needsWork, "known-incident-match")).toBe(false);
  });

  it("flags a pypi takeover (ctx@0.2.2)", () => {
    const { needsWork } = extractHealthSignals(
      mockSnapshot({
        dependencyHealth: depHealthForIncident({
          ecosystem: "pypi",
          outdated: [
            {
              name: "ctx",
              current: "==0.2.2",
              latest: "0.1.2",
              ageMonths: 36,
              lastPublished: "2022-05-21T00:00:00Z",
            },
          ],
        }),
      }),
    );
    const sig = needsWork.find((s) => s.id === "known-incident-match");
    expect(sig).toBeDefined();
    expect(sig?.severity).toBe("high");
    expect(sig?.evidence.paths).toContain("[pypi] ctx@==0.2.2");
  });

  it("flags a cargo typosquat (rustdecimal@1.23.1)", () => {
    const { needsWork } = extractHealthSignals(
      mockSnapshot({
        dependencyHealth: depHealthForIncident({
          ecosystem: "cargo",
          outdated: [
            {
              name: "rustdecimal",
              current: "1.23.1",
              latest: "1.23.1",
              ageMonths: 36,
              lastPublished: "2022-05-01T00:00:00Z",
            },
          ],
        }),
      }),
    );
    const sig = needsWork.find((s) => s.id === "known-incident-match");
    expect(sig).toBeDefined();
    expect(sig?.evidence.paths).toContain("[cargo] rustdecimal@1.23.1");
  });
});

// ------------------- Risky dynamic-execution patterns (#20) -----------

describe("Risky-pattern signal (#20)", () => {
  it("no signal when riskyPatternFindings is absent", () => {
    const result = extractHealthSignals(mockSnapshot());
    const all = [
      ...result.working,
      ...result.needsWork,
      ...result.questions,
    ];
    expect(all.some((s) => s.id === "risky-eval-patterns")).toBe(false);
  });

  it("no signal when findings array is empty", () => {
    const { questions } = extractHealthSignals(
      mockSnapshot({ riskyPatternFindings: { findings: [] } }),
    );
    expect(hasSignal(questions, "risky-eval-patterns")).toBe(false);
  });

  it("buckets into questions with no severity (single file)", () => {
    const { questions, needsWork } = extractHealthSignals(
      mockSnapshot({
        riskyPatternFindings: {
          findings: [
            {
              patternId: "js-eval",
              patternName: "eval() call",
              filePath: "src/runtime.js",
              line: 12,
              snippet: "eval(userInput);",
            },
          ],
        },
      }),
    );
    const sig = questions.find((s) => s.id === "risky-eval-patterns");
    expect(sig).toBeDefined();
    expect(sig?.severity).toBeUndefined();
    // Crucially does NOT land in needsWork — we don't claim severity.
    expect(hasSignal(needsWork, "risky-eval-patterns")).toBe(false);
    expect(sig?.evidence.numbers?.occurrences).toBe(1);
    expect(sig?.evidence.numbers?.files).toBe(1);
    expect(sig?.evidence.paths).toContain("src/runtime.js");
  });

  it("groups multiple findings in the same file with a count suffix", () => {
    const { questions } = extractHealthSignals(
      mockSnapshot({
        riskyPatternFindings: {
          findings: [
            {
              patternId: "js-eval",
              patternName: "eval()",
              filePath: "src/runtime.js",
              line: 5,
              snippet: "eval(a);",
            },
            {
              patternId: "js-eval",
              patternName: "eval()",
              filePath: "src/runtime.js",
              line: 12,
              snippet: "eval(b);",
            },
            {
              patternId: "js-new-function",
              patternName: "new Function()",
              filePath: "src/runtime.js",
              line: 20,
              snippet: "new Function('return 1');",
            },
          ],
        },
      }),
    );
    const sig = questions.find((s) => s.id === "risky-eval-patterns");
    expect(sig?.evidence.numbers?.occurrences).toBe(3);
    expect(sig?.evidence.numbers?.files).toBe(1);
    expect(sig?.evidence.paths).toEqual(["src/runtime.js (×3)"]);
  });
});
