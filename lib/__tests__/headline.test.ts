// Tests for pickHeadline() — the waterfall picker that surfaces ONE
// concrete actionable signal per session for the Overview page.
//
// We hand-build minimal CodeGraph fixtures rather than mocking
// findDuplicateGroups / computeTestCoverage. Two reasons:
//   1. The repo doesn't use vi.mock anywhere — keeps the test style
//      consistent with the rest of the suite.
//   2. The fixtures double as integration coverage: if findDuplicateGroups
//      or computeTestCoverage change semantics in a way that breaks
//      headline picking, these tests catch it.
//
// Each test exercises one waterfall rung. We deliberately also test
// fall-through: e.g. critical-duplicates trumps untested-hotspots even
// when both conditions match.
//
// Pure function, no I/O — fast.
//
import { describe, it, expect } from "vitest";
import { pickHeadline } from "../intelligence/headline";
import type {
  AnalysisSnapshot,
  CommitSummary,
  FileHotspot,
} from "../types";
import type { CodeGraph, FunctionDef, CallEdge } from "../codeAnalysis/types";

// ------------------- Fixture builders -------------------

function snap(overrides: Partial<AnalysisSnapshot> = {}): AnalysisSnapshot {
  return {
    fetchedAt: "2026-05-03T00:00:00Z",
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
      updatedAt: "2026-05-01T00:00:00Z",
      pushedAt: "2026-05-01T00:00:00Z",
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

function emptyGraph(): CodeGraph {
  return {
    functions: [],
    calls: [],
    imports: [],
    fileComplexity: {},
    filesByExt: {},
    byPlugin: {
      javascript: { files: 5, functions: 5, calls: 0, imports: 0 },
    },
  };
}

function fn(
  filePath: string,
  name: string,
  complexity: number,
  bodyHash?: string,
  containerType?: string
): FunctionDef {
  return {
    filePath,
    name,
    startRow: 1,
    endRow: 10,
    complexity,
    ...(bodyHash ? { bodyHash } : {}),
    ...(containerType ? { containerType } : {}),
  };
}

function call(
  fromFile: string,
  toFile: string,
  toFunction: string,
  toContainerType?: string
): CallEdge {
  return {
    fromFile,
    fromFunction: "test_caller",
    calleeName: toFunction,
    toFile,
    toFunction,
    ...(toContainerType ? { toContainerType } : {}),
  };
}

function hotspot(path: string, churn: number, authors = 1): FileHotspot {
  return {
    path,
    churn,
    authors,
    authorLogins: Array(authors)
      .fill(null)
      .map((_, i) => `dev${i}`),
    lastModified: "2026-05-01T00:00:00Z",
    score: churn,
    commits: [],
  };
}

function commit(date: string): CommitSummary {
  return {
    sha: "abc",
    message: "test",
    authorLogin: "dev",
    authorName: "Dev",
    authorEmail: "dev@example.com",
    date,
  };
}

// ------------------- Rule 0a: secret leak -------------------

describe("pickHeadline · secret-leak override", () => {
  it("fires when a critical-severity finding exists", () => {
    const headline = pickHeadline(
      snap({
        secretFindings: {
          findings: [
            {
              filePath: "src/aws.ts",
              line: 12,
              patternId: "aws-access-key",
              patternLabel: "AWS Access Key ID",
              preview: "AKIAQ4...7890",
              severity: "critical",
              confidence: 1.0,
            },
          ],
          filesScanned: 1,
        },
      })
    );
    expect(headline.kind).toBe("secret-leak");
    expect(headline.severity).toBe("critical");
    expect(headline.primary).toContain("AWS Access Key");
    expect(headline.detail).toContain("AKIAQ4...7890");
    expect(headline.ctaLink).toBe("#secrets");
  });

  it("trumps every other rule (incl. critical-duplicates)", () => {
    const cg = emptyGraph();
    cg.functions = [
      fn("src/a.ts", "render", 60, "hashA"),
      fn("src/b.ts", "render", 55, "hashA"),
    ];
    const headline = pickHeadline(
      snap({
        codeGraph: cg,
        secretFindings: {
          findings: [
            {
              filePath: "src/aws.ts",
              line: 12,
              patternId: "aws-access-key",
              patternLabel: "AWS Access Key ID",
              preview: "AKIAQ4...7890",
              severity: "critical",
              confidence: 1.0,
            },
          ],
          filesScanned: 1,
        },
      })
    );
    // critical duplicate would normally fire — secret leak overrides
    expect(headline.kind).toBe("secret-leak");
  });

  it("does NOT fire on medium-only findings (likely public JWTs)", () => {
    const cg = emptyGraph();
    cg.functions = [fn("src/foo.ts", "f", 2)];
    cg.byPlugin = {
      javascript: { files: 1, functions: 1, calls: 0, imports: 0 },
    };
    const headline = pickHeadline(
      snap({
        codeGraph: cg,
        secretFindings: {
          findings: [
            {
              filePath: "src/jwt.ts",
              line: 1,
              patternId: "jwt-token",
              patternLabel: "JWT-like Token",
              preview: "eyJhbG...12ab",
              severity: "medium",
              confidence: 0.8,
            },
          ],
          filesScanned: 1,
        },
      })
    );
    expect(headline.kind).not.toBe("secret-leak");
    // falls through to generic-healthy because no other rule fires
    expect(headline.kind).toBe("generic-healthy");
  });

  it("does not fire on empty findings array", () => {
    const cg = emptyGraph();
    cg.functions = [fn("src/foo.ts", "f", 2)];
    cg.byPlugin = {
      javascript: { files: 1, functions: 1, calls: 0, imports: 0 },
    };
    const headline = pickHeadline(
      snap({
        codeGraph: cg,
        secretFindings: { findings: [], filesScanned: 5 },
      })
    );
    expect(headline.kind).not.toBe("secret-leak");
  });
});

// ------------------- Rule 0b: no-data -------------------

describe("pickHeadline · no-data fallback", () => {
  it("returns no-data when codeGraph is missing", () => {
    const headline = pickHeadline(snap());
    expect(headline.kind).toBe("no-data");
    expect(headline.severity).toBe("info");
    expect(headline.primary).toContain("not available");
    expect(headline.ctaLink).toBeUndefined();
  });
});

// ------------------- Rule 1: critical-duplicates -------------------

describe("pickHeadline · critical-duplicates", () => {
  it("fires when a duplicate group has complexity ≥ 50", () => {
    const cg = emptyGraph();
    cg.functions = [
      fn("src/a.ts", "render", 60, "hashA"),
      fn("src/b.ts", "render", 55, "hashA"),
    ];
    const headline = pickHeadline(snap({ codeGraph: cg }));
    expect(headline.kind).toBe("critical-duplicates");
    expect(headline.severity).toBe("critical");
    expect(headline.primary).toContain("duplicate group");
    expect(headline.primary).toContain("render");
    expect(headline.ctaLink).toBe("code?focus=duplicates");
  });

  it("includes the container in the function name when present", () => {
    const cg = emptyGraph();
    cg.functions = [
      fn("src/a.ts", "process", 80, "hashB", "PaymentService"),
      fn("src/b.ts", "process", 70, "hashB", "OrderService"),
    ];
    const headline = pickHeadline(snap({ codeGraph: cg }));
    expect(headline.kind).toBe("critical-duplicates");
    expect(headline.primary).toContain("PaymentService.process");
  });

  it("does NOT fire when the worst group is below the threshold", () => {
    const cg = emptyGraph();
    cg.functions = [
      fn("src/a.ts", "render", 30, "hashA"),
      fn("src/b.ts", "render", 25, "hashA"),
    ];
    const headline = pickHeadline(snap({ codeGraph: cg }));
    expect(headline.kind).not.toBe("critical-duplicates");
  });
});

// ------------------- Rule 2: many-untested-hotspots -------------------

describe("pickHeadline · many-untested-hotspots", () => {
  it("fires when ≥ 5 untested prod hotspots exist alongside a test file", () => {
    const cg = emptyGraph();
    // Test file with one function so testCoverage classifies it as test
    cg.functions = [
      fn("__tests__/sanity.test.ts", "shouldExist", 1),
      fn("src/foo.ts", "validateInput", 12),
      fn("src/bar.ts", "transformData", 11),
      fn("src/baz.ts", "processOrder", 10),
      fn("src/qux.ts", "checkAuth", 9),
      fn("src/quux.ts", "computeTax", 8),
      fn("src/six.ts", "lookupRate", 7),
    ];
    const headline = pickHeadline(snap({ codeGraph: cg }));
    expect(headline.kind).toBe("many-untested-hotspots");
    expect(headline.severity).toBe("warning");
    // Top hotspot is the highest complexity prod fn
    expect(headline.primary).toContain("validateInput");
    expect(headline.ctaLink).toBe("code?focus=untested");
  });

  it("does NOT fire without a test file (signal needs comparison baseline)", () => {
    const cg = emptyGraph();
    cg.functions = [
      fn("src/foo.ts", "validateInput", 12),
      fn("src/bar.ts", "transformData", 11),
      fn("src/baz.ts", "processOrder", 10),
      fn("src/qux.ts", "checkAuth", 9),
      fn("src/quux.ts", "computeTax", 8),
      fn("src/six.ts", "lookupRate", 7),
    ];
    const headline = pickHeadline(snap({ codeGraph: cg }));
    expect(headline.kind).not.toBe("many-untested-hotspots");
  });

  it("does NOT fire when fewer than 5 untested hotspots qualify", () => {
    const cg = emptyGraph();
    cg.functions = [
      fn("__tests__/sanity.test.ts", "shouldExist", 1),
      fn("src/foo.ts", "validateInput", 12),
      fn("src/bar.ts", "transformData", 11),
    ];
    const headline = pickHeadline(snap({ codeGraph: cg }));
    expect(headline.kind).not.toBe("many-untested-hotspots");
  });
});

// ------------------- Rule 3: low-coverage -------------------

describe("pickHeadline · low-coverage", () => {
  it("fires when ≥ 20 prod fns + < 30% covered", () => {
    const cg = emptyGraph();
    // 25 prod fns with low complexity (so they don't all become hotspots)
    // + 1 test file calling 4 of them = 16% coverage
    cg.functions = [
      fn("__tests__/x.test.ts", "ok", 1),
      ...Array.from({ length: 25 }, (_, i) =>
        fn(`src/m${i}.ts`, `f${i}`, 2)
      ),
    ];
    cg.calls = [
      call("__tests__/x.test.ts", "src/m0.ts", "f0"),
      call("__tests__/x.test.ts", "src/m1.ts", "f1"),
      call("__tests__/x.test.ts", "src/m2.ts", "f2"),
      call("__tests__/x.test.ts", "src/m3.ts", "f3"),
    ];
    const headline = pickHeadline(snap({ codeGraph: cg }));
    expect(headline.kind).toBe("low-coverage");
    expect(headline.severity).toBe("warning");
    expect(headline.primary).toMatch(/\d+%/);
    expect(headline.ctaLink).toBe("code?focus=untested");
  });

  it("does NOT fire when prod fn count is below 20 (sample too small)", () => {
    const cg = emptyGraph();
    cg.functions = [
      fn("__tests__/x.test.ts", "ok", 1),
      ...Array.from({ length: 10 }, (_, i) =>
        fn(`src/m${i}.ts`, `f${i}`, 2)
      ),
    ];
    const headline = pickHeadline(snap({ codeGraph: cg }));
    expect(headline.kind).not.toBe("low-coverage");
  });

  it("does NOT fire when coverage is healthy (≥ 30%)", () => {
    const cg = emptyGraph();
    cg.functions = [
      fn("__tests__/x.test.ts", "ok", 1),
      ...Array.from({ length: 20 }, (_, i) =>
        fn(`src/m${i}.ts`, `f${i}`, 2)
      ),
    ];
    cg.calls = Array.from({ length: 10 }, (_, i) =>
      call("__tests__/x.test.ts", `src/m${i}.ts`, `f${i}`)
    );
    const headline = pickHeadline(snap({ codeGraph: cg }));
    expect(headline.kind).not.toBe("low-coverage");
  });
});

// ------------------- Rule 4: high-churn-hotspot -------------------

describe("pickHeadline · high-churn-hotspot", () => {
  it("fires when the top hotspot churn ≥ 50", () => {
    const headline = pickHeadline(
      snap({
        codeGraph: emptyGraph(),
        hotspots: [hotspot("src/godfile.ts", 88, 3)],
      })
    );
    expect(headline.kind).toBe("high-churn-hotspot");
    expect(headline.severity).toBe("warning");
    expect(headline.primary).toContain("godfile.ts");
    expect(headline.detail).toContain("88 commits");
    expect(headline.ctaLink).toBe("canvas");
  });

  it("uses singular author phrasing when authors === 1", () => {
    const headline = pickHeadline(
      snap({
        codeGraph: emptyGraph(),
        hotspots: [hotspot("src/godfile.ts", 88, 1)],
      })
    );
    expect(headline.detail).toContain("1 author");
    expect(headline.detail).not.toContain("authors");
  });

  it("does NOT fire when the top hotspot churn is below 50", () => {
    const headline = pickHeadline(
      snap({
        codeGraph: emptyGraph(),
        hotspots: [hotspot("src/file.ts", 30, 1)],
      })
    );
    expect(headline.kind).not.toBe("high-churn-hotspot");
  });

  it("skips non-code hotspots (changelog/docs) and leads with the most-changed CODE file", () => {
    const headline = pickHeadline(
      snap({
        codeGraph: emptyGraph(),
        hotspots: [
          hotspot("CHANGES.rst", 339, 7), // changelog — churns every release, not a god-file
          hotspot("docs/quickstart.rst", 185, 6),
          hotspot("src/app.ts", 120, 3), // the real code hotspot
        ],
      })
    );
    expect(headline.kind).toBe("high-churn-hotspot");
    expect(headline.primary).toContain("src/app.ts");
    expect(headline.primary).toContain("most-changed code file");
    expect(headline.primary).not.toContain("CHANGES");
    expect(headline.detail).toContain("120 commits");
  });

  it("does NOT fire when only non-code files are high-churn", () => {
    const headline = pickHeadline(
      snap({
        codeGraph: emptyGraph(),
        hotspots: [
          hotspot("CHANGES.rst", 339, 7),
          hotspot("docs/config.rst", 200, 4),
        ],
      })
    );
    expect(headline.kind).not.toBe("high-churn-hotspot");
  });
});

// ------------------- Rule 5: stale-repo -------------------

describe("pickHeadline · stale-repo", () => {
  it("fires when last commit is > 90 days ago", () => {
    const longAgo = new Date(Date.now() - 200 * 24 * 3600 * 1000).toISOString();
    const headline = pickHeadline(
      snap({
        codeGraph: emptyGraph(),
        recentCommits: [commit(longAgo)],
      })
    );
    expect(headline.kind).toBe("stale-repo");
    expect(headline.severity).toBe("info");
    expect(headline.primary).toMatch(/\d+ days ago/);
  });

  it("does NOT fire when last commit is recent", () => {
    const recent = new Date(Date.now() - 5 * 24 * 3600 * 1000).toISOString();
    const headline = pickHeadline(
      snap({
        codeGraph: emptyGraph(),
        recentCommits: [commit(recent)],
      })
    );
    expect(headline.kind).not.toBe("stale-repo");
  });
});

// ------------------- Rule 6: generic-healthy fallback -------------------

describe("pickHeadline · generic-healthy fallback", () => {
  it("falls through to generic-healthy when no other rule fires", () => {
    const cg = emptyGraph();
    cg.functions = [fn("src/foo.ts", "f", 2)];
    cg.byPlugin = {
      javascript: { files: 1, functions: 1, calls: 0, imports: 0 },
      python: { files: 1, functions: 1, calls: 0, imports: 0 },
    };
    const headline = pickHeadline(snap({ codeGraph: cg }));
    expect(headline.kind).toBe("generic-healthy");
    expect(headline.severity).toBe("info");
    expect(headline.primary).toContain("2 languages");
    expect(headline.ctaLink).toBe("code");
  });

  it("excludes regex-fallback from the language count", () => {
    const cg = emptyGraph();
    cg.functions = [fn("src/foo.ts", "f", 2)];
    cg.byPlugin = {
      javascript: { files: 1, functions: 1, calls: 0, imports: 0 },
      "regex-fallback": { files: 5, functions: 5, calls: 0, imports: 0 },
    };
    const headline = pickHeadline(snap({ codeGraph: cg }));
    expect(headline.primary).toContain("1 language");
    expect(headline.primary).not.toContain("2 languages");
  });
});

// ------------------- Waterfall priority -------------------

describe("pickHeadline · waterfall priority", () => {
  it("critical-duplicates trumps untested-hotspots", () => {
    const cg = emptyGraph();
    // Critical duplicate group AND many untested hotspots — duplicates wins
    cg.functions = [
      fn("__tests__/x.test.ts", "ok", 1),
      fn("src/dup1.ts", "render", 60, "hashA"),
      fn("src/dup2.ts", "render", 55, "hashA"),
      fn("src/foo.ts", "validateInput", 12),
      fn("src/bar.ts", "transformData", 11),
      fn("src/baz.ts", "processOrder", 10),
      fn("src/qux.ts", "checkAuth", 9),
      fn("src/quux.ts", "computeTax", 8),
    ];
    const headline = pickHeadline(snap({ codeGraph: cg }));
    expect(headline.kind).toBe("critical-duplicates");
  });

  it("untested-hotspots trumps high-churn", () => {
    const cg = emptyGraph();
    cg.functions = [
      fn("__tests__/x.test.ts", "ok", 1),
      fn("src/foo.ts", "validateInput", 12),
      fn("src/bar.ts", "transformData", 11),
      fn("src/baz.ts", "processOrder", 10),
      fn("src/qux.ts", "checkAuth", 9),
      fn("src/quux.ts", "computeTax", 8),
      fn("src/six.ts", "lookupRate", 7),
    ];
    const headline = pickHeadline(
      snap({
        codeGraph: cg,
        hotspots: [hotspot("src/godfile.ts", 200, 5)],
      })
    );
    expect(headline.kind).toBe("many-untested-hotspots");
  });

  it("high-churn trumps stale-repo when both conditions match", () => {
    const longAgo = new Date(Date.now() - 200 * 24 * 3600 * 1000).toISOString();
    const headline = pickHeadline(
      snap({
        codeGraph: emptyGraph(),
        hotspots: [hotspot("src/godfile.ts", 88, 3)],
        recentCommits: [commit(longAgo)],
      })
    );
    expect(headline.kind).toBe("high-churn-hotspot");
  });
});

// ------------------- Rule 6: no-code-parsed -------------------
//
// The graph EXISTS but is empty — nothing was parsed. Must never fall
// through to generic-healthy ("0 functions … looks healthy" read as
// broken on a pure-Dart repo, correctly). Names the dominant language
// when it's one we don't parse.

describe("pickHeadline · no-code-parsed", () => {
  it("names the dominant unsupported language (Dart)", () => {
    const cg = emptyGraph();
    cg.byPlugin = {};
    const headline = pickHeadline(
      snap({
        codeGraph: cg,
        languages: { Dart: 235907, Shell: 6341 },
      })
    );
    expect(headline.kind).toBe("no-code-parsed");
    expect(headline.primary).toContain("Dart isn't a language CodeTrawl parses yet");
    expect(headline.detail).toContain("still apply");
    expect(headline.primary).not.toContain("healthy");
  });

  it("uses the neutral message when the dominant language IS supported", () => {
    const cg = emptyGraph();
    cg.byPlugin = {};
    const headline = pickHeadline(
      snap({
        codeGraph: cg,
        languages: { TypeScript: 1000 },
      })
    );
    expect(headline.kind).toBe("no-code-parsed");
    expect(headline.primary).toBe("No parseable code found in this repo");
  });

  it("does NOT fire when functions were parsed", () => {
    const cg = emptyGraph();
    cg.functions = [fn("src/foo.ts", "f", 2)];
    const headline = pickHeadline(
      snap({ codeGraph: cg, languages: { Dart: 999999 } })
    );
    expect(headline.kind).toBe("generic-healthy");
  });
});
