// Tests for the signal engine. Many detectors — we test via the public
// extractHealthSignals() so we exercise the real aggregation + gating logic.

import { describe, it, expect } from "vitest";
import { extractHealthSignals } from "../signals";
import type { CodeGraph } from "../codeAnalysis/types";
import type {
  AnalysisSnapshot,
  FileGraph,
  FileHotspot,
  PullRequestSummary,
  DependencyHealth,
  Contributor,
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

// ------------------- Untested hotspots: scope awareness -------------------

describe("Untested hotspots — scope awareness", () => {
  const codeHotspots: FileHotspot[] = [
    hotspot("src/a.ts", 60),
    hotspot("src/b.ts", 55),
    hotspot("src/c.ts", 50),
    hotspot("src/d.ts", 45),
    hotspot("src/e.ts", 40),
    hotspot("src/f.ts", 35),
  ];

  it("fires on a full-repo analysis with untested code hotspots", () => {
    const { needsWork } = extractHealthSignals(
      mockSnapshot({ hotspots: codeHotspots })
    );
    expect(hasSignal(needsWork, "untested-hotspots")).toBe(true);
  });

  it("is suppressed when scoped to a subdir (test suite likely outside scope)", () => {
    const { needsWork } = extractHealthSignals(
      mockSnapshot({ hotspots: codeHotspots, analyzedSubdir: "src" })
    );
    expect(hasSignal(needsWork, "untested-hotspots")).toBe(false);
  });
});

// ------------------- Bot filtering: contributors / Team -------------------

describe("Bot filtering — contributors", () => {
  const human = (i: number): Contributor => ({
    login: `human${i}`,
    avatarUrl: "",
    htmlUrl: "",
    contributions: 10,
  });
  const bot = (login: string): Contributor => ({
    login,
    avatarUrl: "",
    htmlUrl: "",
    contributions: 500,
  });
  const bots = [bot("dependabot[bot]"), bot("pre-commit-ci[bot]")];

  it("excludes bots from the broad-contributor-base count", () => {
    const humans = Array.from({ length: 20 }, (_, i) => human(i));
    const { working } = extractHealthSignals(
      mockSnapshot({ contributors: [...humans, ...bots] })
    );
    const s = working.find((x) => x.id === "many-contributors");
    expect(s).toBeDefined();
    // 20 humans counted, the 2 bots excluded.
    expect(s!.evidence.numbers!.totalContributors).toBe(20);
  });

  it("does not fire broad-contributor-base when humans < 20 after excluding bots", () => {
    const humans = Array.from({ length: 18 }, (_, i) => human(i));
    const { working } = extractHealthSignals(
      mockSnapshot({ contributors: [...humans, ...bots] })
    );
    expect(working.find((x) => x.id === "many-contributors")).toBeUndefined();
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

describe("detectWeakSuite (Arc 1)", () => {
  type WS = NonNullable<AnalysisSnapshot["weakSuite"]>;
  const ws = (
    smokeOnlyRatio: number,
    assertionDensity: number,
    testCases = 40,
  ): WS => ({
    counts: { hollow: 0, thin: 0, solid: 0 },
    totals: {
      testFiles: 5,
      testCases,
      assertions: Math.round(assertionDensity * testCases),
      smokeOnlyCases: Math.round(smokeOnlyRatio * testCases),
      assertionDensity,
      smokeOnlyRatio,
    },
  });

  it("no signal when weakSuite is absent (non-JS / legacy snapshot)", () => {
    const r = extractHealthSignals(mockSnapshot());
    const all = [...r.working, ...r.needsWork, ...r.questions];
    expect(all.some((s) => s.id === "weak-suite" || s.id === "assertion-dense-tests")).toBe(false);
  });

  it("suppresses the signal on tiny suites (below the sample floor)", () => {
    const r = extractHealthSignals(mockSnapshot({ weakSuite: ws(0.6, 0.5, 10) }));
    expect(hasSignal(r.needsWork, "weak-suite")).toBe(false);
  });

  it("flags high severity when most cases assert nothing meaningful", () => {
    const { needsWork } = extractHealthSignals(mockSnapshot({ weakSuite: ws(0.5, 0.6) }));
    const sig = needsWork.find((s) => s.id === "weak-suite");
    expect(sig).toBeDefined();
    expect(sig?.severity).toBe("high");
    expect(sig?.evidence.numbers?.smokeOnlyPct).toBe(50);
    expect(sig?.evidence.paths).toBeUndefined(); // aggregate-only teaser
  });

  it("flags medium severity for a real minority of smoke-only cases", () => {
    const { needsWork } = extractHealthSignals(mockSnapshot({ weakSuite: ws(0.25, 1.2) }));
    const sig = needsWork.find((s) => s.id === "weak-suite");
    expect(sig?.severity).toBe("medium");
  });

  it("credits a dense, value-checking suite as a positive", () => {
    const { working, needsWork } = extractHealthSignals(mockSnapshot({ weakSuite: ws(0.05, 2.0) }));
    expect(hasSignal(working, "assertion-dense-tests")).toBe(true);
    expect(hasSignal(needsWork, "weak-suite")).toBe(false);
  });

  it("stays quiet in the middle (neither weak nor notably strong)", () => {
    const r = extractHealthSignals(mockSnapshot({ weakSuite: ws(0.15, 1.2) }));
    expect(hasSignal(r.needsWork, "weak-suite")).toBe(false);
    expect(hasSignal(r.working, "assertion-dense-tests")).toBe(false);
  });
});

// ─── codeGraph detectors ────────────────────────────────────────────────────
// The first Code-dimension signals that read snap.codeGraph. Before these, the
// whole function-level AST layer powered panels but never reached a tile.

describe("codeGraph signals", () => {
  const fn = (
    filePath: string,
    name: string,
    complexity: number,
    bodyHash?: string
  ) => ({ filePath, name, startRow: 1, endRow: 9, complexity, bodyHash });

  const graph = (over: Partial<CodeGraph> = {}): CodeGraph => ({
    functions: [],
    calls: [],
    imports: [],
    fileComplexity: {},
    filesByExt: {},
    byPlugin: {},
    ...over,
  });

  const idsOf = (snap: AnalysisSnapshot) => {
    const s = extractHealthSignals(snap);
    return {
      working: s.working.map((x) => x.id),
      needsWork: s.needsWork.map((x) => x.id),
      questions: s.questions.map((x) => x.id),
    };
  };

  it("emits nothing at all without a code graph — silence, never a guess", () => {
    const ids = idsOf(mockSnapshot({ codeGraph: undefined }));
    const all = [...ids.working, ...ids.needsWork, ...ids.questions];
    expect(all).not.toContain("duplicate-implementations");
    expect(all).not.toContain("complexity-concentration");
    expect(all).not.toContain("limited-direct-coverage");
    expect(all).not.toContain("unit-tested-core");
  });

  describe("duplicate-implementations", () => {
    it("fires on structurally identical functions and scales severity with the worst group", () => {
      const codeGraph = graph({
        functions: [
          fn("a.ts", "parse", 24, "hash-big"),
          fn("b.ts", "parseAgain", 24, "hash-big"),
          fn("c.ts", "fmt", 7, "hash-small"),
          fn("d.ts", "format", 7, "hash-small"),
        ],
      });
      const s = extractHealthSignals(mockSnapshot({ codeGraph }));
      const dup = s.needsWork.find((x) => x.id === "duplicate-implementations");
      expect(dup).toBeDefined();
      // complexity 24 clears the high bar even with only two groups.
      expect(dup!.severity).toBe("high");
      expect(dup!.evidence.numbers?.groups).toBe(2);
      expect(dup!.evidence.numbers?.copies).toBe(4);
    });

    it("ignores trivial duplicates — one-line accessors repeat by accident, not design", () => {
      const codeGraph = graph({
        functions: [
          fn("a.ts", "getId", 1, "trivial"),
          fn("b.ts", "getName", 1, "trivial"),
        ],
      });
      const s = extractHealthSignals(mockSnapshot({ codeGraph }));
      expect(s.needsWork.map((x) => x.id)).not.toContain("duplicate-implementations");
    });

    it("stays quiet on a single duplicated shape — that's reuse, not a pattern", () => {
      const codeGraph = graph({
        functions: [fn("a.ts", "x", 9, "h"), fn("b.ts", "y", 9, "h")],
      });
      const dup = extractHealthSignals(mockSnapshot({ codeGraph })).needsWork.find(
        (x) => x.id === "duplicate-implementations"
      );
      expect(dup).toBeUndefined();
    });
  });

  describe("complexity-concentration", () => {
    it("reports when a handful of functions hold most of the branching", () => {
      // 60 trivial functions + 3 monsters: the top 5% carry the majority.
      const functions = [
        ...Array.from({ length: 60 }, (_, i) => fn(`s/f${i}.ts`, `f${i}`, 1)),
        fn("s/big1.ts", "big1", 90),
        fn("s/big2.ts", "big2", 80),
        fn("s/big3.ts", "big3", 70),
      ];
      const c = extractHealthSignals(mockSnapshot({ codeGraph: graph({ functions }) })).questions.find(
        (x) => x.id === "complexity-concentration"
      );
      expect(c).toBeDefined();
      expect(c!.evidence.numbers?.worstComplexity).toBe(90);
      expect(c!.evidence.numbers!.sharePct).toBeGreaterThan(35);
    });

    it("stays quiet when complexity is spread evenly", () => {
      const functions = Array.from({ length: 60 }, (_, i) => fn(`s/f${i}.ts`, `f${i}`, 5));
      const c = extractHealthSignals(mockSnapshot({ codeGraph: graph({ functions }) })).questions.find(
        (x) => x.id === "complexity-concentration"
      );
      expect(c).toBeUndefined();
    });

    it("stays quiet on a small codebase — few functions concentrate by arithmetic", () => {
      const functions = [fn("a.ts", "a", 50), fn("b.ts", "b", 1), fn("c.ts", "c", 1)];
      const c = extractHealthSignals(mockSnapshot({ codeGraph: graph({ functions }) })).questions.find(
        (x) => x.id === "complexity-concentration"
      );
      expect(c).toBeUndefined();
    });
  });

  describe("direct test coverage", () => {
    /** N production functions, `tested` of them called from a test file. */
    const covGraph = (prod: number, tested: number) => {
      const functions = [
        ...Array.from({ length: prod }, (_, i) => fn(`src/p${i}.ts`, `p${i}`, 2)),
        fn("src/__tests__/x.test.ts", "spec", 1),
      ];
      const calls = Array.from({ length: tested }, (_, i) => ({
        fromFile: "src/__tests__/x.test.ts",
        fromFunction: "spec",
        calleeName: `p${i}`,
        toFile: `src/p${i}.ts`,
        toFunction: `p${i}`,
      }));
      return graph({ functions, calls });
    };

    it("credits a suite that calls production functions directly", () => {
      const s = extractHealthSignals(mockSnapshot({ codeGraph: covGraph(40, 20) }));
      expect(s.working.map((x) => x.id)).toContain("unit-tested-core");
      expect(s.questions.map((x) => x.id)).not.toContain("limited-direct-coverage");
    });

    it("calls a 0% suite end-to-end shaped — a question, NEVER a failure", () => {
      // express reads 0% here with an excellent supertest suite. Reporting that
      // as needsWork would be a confidently wrong claim about tested code.
      const s = extractHealthSignals(mockSnapshot({ codeGraph: covGraph(40, 0) }));
      const q = s.questions.find((x) => x.id === "limited-direct-coverage");
      expect(q).toBeDefined();
      expect(q!.detail).toContain("does not mean the code is untested");
      expect(s.needsWork.map((x) => x.id)).not.toContain("limited-direct-coverage");
    });

    it("still speaks in the middle of the range instead of going silent", () => {
      // An earlier cut only spoke at 0-3% and 30%+, which left six of ten real
      // repos (7%, 12%, 15%, 28%) with nothing said.
      const q = extractHealthSignals(mockSnapshot({ codeGraph: covGraph(40, 5) })).questions.find(
        (x) => x.id === "limited-direct-coverage"
      );
      expect(q).toBeDefined();
      expect(q!.evidence.numbers?.coveragePct).toBe(13);
    });

    it("says nothing when there are no test files to reason about", () => {
      const noTests = graph({
        functions: Array.from({ length: 40 }, (_, i) => fn(`src/p${i}.ts`, `p${i}`, 2)),
      });
      const s = extractHealthSignals(mockSnapshot({ codeGraph: noTests }));
      const all = [...s.working, ...s.questions].map((x) => x.id);
      expect(all).not.toContain("limited-direct-coverage");
      expect(all).not.toContain("unit-tested-core");
    });
  });
});

describe("consistent-cadence", () => {
  const WEEK = 7 * 24 * 60 * 60 * 1000;
  const ANCHOR = "2026-05-19T00:00:00Z";
  /** `n` CONSECUTIVE weeks with commits, ending at the anchor. */
  const consecutive = (n: number, offsetWeeks = 0) =>
    Array.from({ length: n }, (_, i) => ({
      week: new Date(Date.parse(ANCHOR) - (i + offsetWeeks) * WEEK)
        .toISOString()
        .slice(0, 10),
      count: 3,
    }));
  /** `count` commit weeks scattered across `spread` weeks — the real shape of a
   *  repo that has been alive a long time but works in bursts. */
  const sparse = (count: number, spread: number) =>
    Array.from({ length: count }, (_, i) => ({
      week: new Date(Date.parse(ANCHOR) - Math.floor((i * spread) / count) * WEEK)
        .toISOString()
        .slice(0, 10),
      count: 3,
    }));

  const cadence = (commitActivity: { week: string; count: number }[]) =>
    extractHealthSignals(
      mockSnapshot({ fetchedAt: ANCHOR, commitActivity })
    ).working.find((s) => s.id === "consistent-cadence");

  it("does not fire on sparse commits spread over years — the vacuous-denominator bug", () => {
    // commitActivity holds no zero buckets, so activeWeeks/weeks.length was
    // always 1.0 and this fired for every repo, claiming "677 of 677 weeks".
    expect(cadence(sparse(20, 500))).toBeUndefined();
  });

  it("fires when most weeks in the past year actually had a commit", () => {
    // 40 recent weeks of commits, on a repo that is demonstrably older than a
    // year — so the window is the full 52, not the repo's age.
    const c = cadence([...consecutive(40), ...consecutive(1, 120)]);
    expect(c).toBeDefined();
    expect(c!.evidence.numbers?.windowWeeks).toBe(52);
    expect(c!.evidence.numbers!.activePct).toBeGreaterThanOrEqual(60);
  });

  it("does not praise a dead repo for its old rhythm — the window is anchored to NOW", () => {
    // Dense weekly commits, but all of them five years before the snapshot.
    const old = Array.from({ length: 60 }, (_, i) => ({
      week: new Date(Date.parse(ANCHOR) - (260 + i) * WEEK).toISOString().slice(0, 10),
      count: 5,
    }));
    expect(cadence(old)).toBeUndefined();
  });

  it("judges a young repo on the history it has, not on silence it couldn't fill", () => {
    // 8 weeks old, committed in 7 of them: steady, and shouldn't be divided by 52.
    const c = cadence(consecutive(7));
    expect(c).toBeDefined();
    expect(c!.evidence.numbers?.windowWeeks).toBeLessThan(12);
  });

  it("stays quiet below the minimum history", () => {
    expect(cadence(consecutive(3))).toBeUndefined();
  });

  it("never reports a ratio above 100%, even on duplicated buckets", () => {
    const c = cadence(sparse(45, 40));
    if (c) {
      expect(c.evidence.numbers!.activeWeeks).toBeLessThanOrEqual(
        c.evidence.numbers!.windowWeeks
      );
    }
  });
});

// ─── Team dimension on resolved identity ────────────────────────────────────
// All four Team detectors used to read FileHotspot.authorLogins, which holds
// GitHub logins and only those. A login is recoverable only from a
// users.noreply.github.com commit address, so on four of eleven stored
// snapshots — this repo included — it resolved for ZERO hotspots and the whole
// dimension went dark. See lib/authorIdentity.ts.

describe("Team signals — identity from the commit index", () => {
  const commits = (spec: Array<[string, string | null, number]>) => {
    const commitIndex: Record<string, { d: string; a: string | null; n: string }> = {};
    let i = 0;
    for (const [name, login, count] of spec) {
      for (let k = 0; k < count; k++) {
        commitIndex[`sha${i++}`] = { d: "2026-05-01T00:00:00Z", a: login, n: name };
      }
    }
    return commitIndex;
  };
  const recent = Array.from({ length: 10 }, () => ({
    sha: "x",
    message: "m",
    author: "a",
    date: "2026-05-01T00:00:00Z",
  })) as never;

  const teamIds = (snap: AnalysisSnapshot) => {
    const s = extractHealthSignals(snap);
    return [...s.working, ...s.needsWork, ...s.questions].map((x) => x.id);
  };

  it("finds a solo project whose commits carry no GitHub login at all", () => {
    // The exact shape of this repo: 0% login resolution, one human.
    const snap = mockSnapshot({
      commitIndex: commits([["Jonas Hansen", null, 99]]),
      recentCommits: recent,
    });
    const solo = extractHealthSignals(snap).questions.find((x) => x.id === "solo-project");
    expect(solo).toBeDefined();
    expect(solo!.detail).toContain("100%");
    // No login → no "@", because the UI links @names to github.com/<name>.
    expect(solo!.detail).not.toContain("@");
  });

  it("still calls it solo when one person commits under two git configs", () => {
    // "Jonas Hansen" and "jonas" are the same human with two user.name values.
    // Counting distinct strings said 2 and killed the signal; share says 98%.
    const snap = mockSnapshot({
      commitIndex: commits([["Jonas Hansen", null, 98], ["jonas", null, 2]]),
      recentCommits: recent,
    });
    expect(teamIds(snap)).toContain("solo-project");
  });

  it("does not call a two-person project solo", () => {
    const snap = mockSnapshot({
      commitIndex: commits([["Ada", null, 60], ["Grace", null, 40]]),
      recentCommits: recent,
    });
    expect(teamIds(snap)).not.toContain("solo-project");
  });

  it("folds a name into the login the same person also commits under", () => {
    const snap = mockSnapshot({
      commitIndex: commits([["Ada Lovelace", "ada", 50], ["Ada Lovelace", null, 45]]),
      recentCommits: recent,
    });
    const solo = extractHealthSignals(snap).questions.find((x) => x.id === "solo-project");
    expect(solo).toBeDefined();
    // Folded → one identity at 95%, and it IS a login, so it gets the @.
    expect(solo!.detail).toContain("@ada");
  });

  it("names the few who carry a large project — the gap between solo and 20+", () => {
    const snap = mockSnapshot({
      commitIndex: commits([
        ["Core One", null, 30], ["Core Two", null, 25], ["Core Three", null, 16],
        ["Drive By", null, 3], ["Someone", null, 3], ["Else", null, 3],
      ]),
      recentCommits: recent,
    });
    const c = extractHealthSignals(snap).questions.find((x) => x.id === "concentrated-ownership");
    expect(c).toBeDefined();
    expect(c!.evidence.numbers!.top3SharePct).toBeGreaterThanOrEqual(70);
  });

  it("stays quiet on concentration when work is genuinely spread", () => {
    const snap = mockSnapshot({
      commitIndex: commits(
        Array.from({ length: 10 }, (_, i) => [`Dev${i}`, null, 10] as [string, null, number])
      ),
      recentCommits: recent,
    });
    expect(teamIds(snap)).not.toContain("concentrated-ownership");
  });

  it("ignores bots when deciding who owns the project", () => {
    const snap = mockSnapshot({
      commitIndex: commits([["Ada", null, 50], ["dependabot[bot]", "dependabot[bot]", 50]]),
      recentCommits: recent,
    });
    // Ada is the only human, so she holds 100% of human commits.
    expect(teamIds(snap)).toContain("solo-project");
  });

  it("falls back to logins when there is no commit index (the REST-sampled path)", () => {
    const snap = mockSnapshot({
      hotspots: [
        {
          path: "src/a.ts",
          churn: 10,
          authors: 1,
          authorLogins: ["ada"],
          lastModified: "2026-05-01T00:00:00Z",
          score: 7,
          commits: ["s1"],
        },
      ],
      recentCommits: recent,
    });
    expect(teamIds(snap)).toContain("solo-project");
  });
});

// ─── Hygiene: CI supply-chain posture ───────────────────────────────────────
// ciHardening has driven the Packages panel and the evidence pack since it
// shipped but never reached a signal, so Hygiene had two detectors, both
// questions, and its tile could only be amber or green-by-silence.
describe("CI hardening signals", () => {
  const report = (over: Partial<NonNullable<AnalysisSnapshot["ciHardening"]>> = {}) =>
    ({
      workflowCount: 2,
      actions: [{ raw: "actions/checkout@abc123" }],
      unpinned: [],
      permissions: [],
      findings: [],
      posture: "hardened",
      ...over,
    }) as NonNullable<AnalysisSnapshot["ciHardening"]>;

  const ids = (ciHardening: AnalysisSnapshot["ciHardening"]) => {
    const s = extractHealthSignals(mockSnapshot({ ciHardening }));
    return [...s.working, ...s.needsWork, ...s.questions].map((x) => x.id);
  };

  it("never claims CI is hardened when no workflow was read", () => {
    // posture is derived from findings alone, so zero readable workflows yields
    // zero findings and therefore "hardened". Saying so would be a confident
    // claim about something we never looked at.
    expect(ids(report({ workflowCount: 0, posture: "hardened" }))).not.toContain("ci-hardened");
  });

  it("says nothing at all when the repo has no CI report", () => {
    expect(ids(undefined)).not.toContain("ci-hardened");
  });

  it("names what it checked when CI is genuinely hardened", () => {
    const s = extractHealthSignals(mockSnapshot({ ciHardening: report() }));
    const ok = s.working.find((x) => x.id === "ci-hardened");
    expect(ok).toBeDefined();
    // Green must be a statement about evidence, not about silence.
    expect(ok!.detail).toMatch(/pinned to a commit/);
    expect(ok!.detail).toMatch(/token scope/);
  });

  it("raises unpinned actions as high severity and cites the incident", () => {
    const s = extractHealthSignals(
      mockSnapshot({
        ciHardening: report({
          posture: "exposed",
          unpinned: [{ raw: "tj-actions/changed-files@v35" }] as never,
          findings: [
            {
              id: "unpinned-actions",
              severity: "high",
              title: "unpinned",
              count: 1,
              evidence: ["tj-actions/changed-files@v35 in ci.yml"],
              incident: {
                name: "tj-actions/changed-files backdoor (CVE-2025-30066)",
                date: "2025-03-14",
                url: "https://example.test",
                summary: "s",
              },
            },
          ] as never,
        }),
      })
    );
    const bad = s.needsWork.find((x) => x.id === "ci-supply-chain-exposed");
    expect(bad?.severity).toBe("high");
    expect(bad!.detail).toContain("CVE-2025-30066");
    expect(bad!.evidence.paths).toContain("tj-actions/changed-files@v35 in ci.yml");
  });

  it("reports broad token scope as medium, not as an exposure", () => {
    const got = ids(
      report({
        posture: "attention",
        findings: [
          { id: "broad-permissions", severity: "medium", title: "t", count: 1, evidence: [] },
        ] as never,
      })
    );
    expect(got).toContain("ci-permissions-broad");
    expect(got).not.toContain("ci-supply-chain-exposed");
    expect(got).not.toContain("ci-hardened");
  });

  it("leads with the worst finding when a repo has several", () => {
    const got = ids(
      report({
        posture: "exposed",
        findings: [
          { id: "broad-permissions", severity: "medium", title: "t", count: 3, evidence: [] },
          { id: "unpinned-actions", severity: "high", title: "t", count: 9, evidence: [] },
        ] as never,
      })
    );
    expect(got).toContain("ci-supply-chain-exposed");
    expect(got).not.toContain("ci-permissions-broad");
  });
});
