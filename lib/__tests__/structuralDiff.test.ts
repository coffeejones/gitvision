// Tests for structuralDiff() — the cross-snapshot structural-change
// engine that powers the v0.67 "structural changes since last visit"
// panel and the compare_sessions MCP tool.
//
// Hand-built CodeGraph fixtures so each axis (functions added/removed,
// duplicate groups, coverage, complexity shifts) is verified in
// isolation. End-to-end behavior (degraded mode, content-emptiness
// check) covered separately.

import { describe, it, expect } from "vitest";
import {
  structuralDiff,
  structuralDiffHasContent,
} from "../intelligence/structuralDiff";
import type { AnalysisSnapshot, CodeGraph } from "../types";
import type { CallEdge, FunctionDef } from "../codeAnalysis/types";

// ---------------- Fixture builders ----------------

function snap(
  overrides: Partial<AnalysisSnapshot> & { fetchedAt?: string } = {}
): AnalysisSnapshot {
  return {
    fetchedAt: overrides.fetchedAt ?? "2026-05-06T00:00:00Z",
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
      updatedAt: "2026-05-06T00:00:00Z",
      pushedAt: "2026-05-06T00:00:00Z",
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
    byPlugin: {},
    generatedAt: "2026-05-06T00:00:00Z",
  };
}

function fn(
  filePath: string,
  name: string,
  complexity = 1,
  options: { containerType?: string; bodyHash?: string } = {}
): FunctionDef {
  return {
    filePath,
    name,
    startRow: 1,
    endRow: 10,
    complexity,
    ...(options.containerType ? { containerType: options.containerType } : {}),
    ...(options.bodyHash ? { bodyHash: options.bodyHash } : {}),
  };
}

function call(
  fromFile: string,
  fromFn: string,
  toFile: string,
  toFn: string
): CallEdge {
  return {
    fromFile,
    fromFunction: fromFn,
    calleeName: toFn,
    toFile,
    toFunction: toFn,
  };
}

// ---------------- Function diff ----------------

describe("structuralDiff · functionsAdded / functionsRemoved", () => {
  it("detects functions added in curr that weren't in prev", () => {
    const prevCg = emptyGraph();
    prevCg.functions = [fn("src/a.ts", "foo", 5)];
    const currCg = emptyGraph();
    currCg.functions = [
      fn("src/a.ts", "foo", 5),
      fn("src/a.ts", "bar", 10),
      fn("src/b.ts", "baz", 3),
    ];
    const diff = structuralDiff(
      snap({ codeGraph: prevCg }),
      snap({ codeGraph: currCg })
    );
    expect(diff.totalAdded).toBe(2);
    expect(diff.functionsAdded.map((f) => f.name)).toEqual(["bar", "baz"]);
    expect(diff.totalRemoved).toBe(0);
  });

  it("detects functions removed from prev that aren't in curr", () => {
    const prevCg = emptyGraph();
    prevCg.functions = [
      fn("src/a.ts", "foo", 5),
      fn("src/a.ts", "obsolete", 7),
    ];
    const currCg = emptyGraph();
    currCg.functions = [fn("src/a.ts", "foo", 5)];
    const diff = structuralDiff(
      snap({ codeGraph: prevCg }),
      snap({ codeGraph: currCg })
    );
    expect(diff.totalRemoved).toBe(1);
    expect(diff.functionsRemoved[0].name).toBe("obsolete");
    expect(diff.totalAdded).toBe(0);
  });

  it("treats same-named methods on different containers as distinct", () => {
    const prevCg = emptyGraph();
    prevCg.functions = [fn("src/a.ts", "save", 5, { containerType: "User" })];
    const currCg = emptyGraph();
    currCg.functions = [
      fn("src/a.ts", "save", 5, { containerType: "User" }),
      fn("src/a.ts", "save", 4, { containerType: "Order" }),
    ];
    const diff = structuralDiff(
      snap({ codeGraph: prevCg }),
      snap({ codeGraph: currCg })
    );
    expect(diff.totalAdded).toBe(1);
    expect(diff.functionsAdded[0].containerType).toBe("Order");
  });

  it("caps the displayed list at 10 but reports the full total", () => {
    const prevCg = emptyGraph();
    const currCg = emptyGraph();
    currCg.functions = Array.from({ length: 30 }, (_, i) =>
      fn(`src/f${i}.ts`, `func${i}`, i + 1)
    );
    const diff = structuralDiff(
      snap({ codeGraph: prevCg }),
      snap({ codeGraph: currCg })
    );
    expect(diff.totalAdded).toBe(30);
    expect(diff.functionsAdded).toHaveLength(10);
  });

  it("sorts added functions by complexity desc", () => {
    const prevCg = emptyGraph();
    const currCg = emptyGraph();
    currCg.functions = [
      fn("src/a.ts", "low", 2),
      fn("src/a.ts", "high", 20),
      fn("src/a.ts", "mid", 8),
    ];
    const diff = structuralDiff(
      snap({ codeGraph: prevCg }),
      snap({ codeGraph: currCg })
    );
    expect(diff.functionsAdded.map((f) => f.name)).toEqual([
      "high",
      "mid",
      "low",
    ]);
  });
});

// ---------------- Duplicate-group diff ----------------

describe("structuralDiff · duplicate group changes", () => {
  it("counts duplicate groups added when curr has new shared hashes", () => {
    const prevCg = emptyGraph();
    const currCg = emptyGraph();
    // Two functions with identical bodyHash + complexity >= 5 = a new
    // duplicate group in curr only.
    currCg.functions = [
      fn("src/a.ts", "doX", 8, { bodyHash: "newHash" }),
      fn("src/b.ts", "doX", 8, { bodyHash: "newHash" }),
    ];
    const diff = structuralDiff(
      snap({ codeGraph: prevCg }),
      snap({ codeGraph: currCg })
    );
    expect(diff.duplicateGroupsAdded).toBe(1);
    expect(diff.duplicateGroupsDissolved).toBe(0);
  });

  it("counts duplicate groups dissolved when prev had them and curr doesn't", () => {
    const prevCg = emptyGraph();
    prevCg.functions = [
      fn("src/a.ts", "doX", 8, { bodyHash: "oldHash" }),
      fn("src/b.ts", "doX", 8, { bodyHash: "oldHash" }),
    ];
    const currCg = emptyGraph();
    // The shared helper was extracted — only one copy remains
    currCg.functions = [fn("src/shared.ts", "doX", 8, { bodyHash: "oldHash" })];
    const diff = structuralDiff(
      snap({ codeGraph: prevCg }),
      snap({ codeGraph: currCg })
    );
    expect(diff.duplicateGroupsDissolved).toBe(1);
    expect(diff.duplicateGroupsAdded).toBe(0);
  });

  it("handles both sides having different dup-groups", () => {
    const prevCg = emptyGraph();
    prevCg.functions = [
      fn("src/a.ts", "p1", 8, { bodyHash: "hashA" }),
      fn("src/b.ts", "p1", 8, { bodyHash: "hashA" }),
    ];
    const currCg = emptyGraph();
    currCg.functions = [
      fn("src/c.ts", "c1", 8, { bodyHash: "hashB" }),
      fn("src/d.ts", "c1", 8, { bodyHash: "hashB" }),
    ];
    const diff = structuralDiff(
      snap({ codeGraph: prevCg }),
      snap({ codeGraph: currCg })
    );
    expect(diff.duplicateGroupsAdded).toBe(1);
    expect(diff.duplicateGroupsDissolved).toBe(1);
  });
});

// ---------------- Coverage diff ----------------

describe("structuralDiff · coverageDelta", () => {
  function mkSnapWithCoverage(
    testCount: number,
    prodCount: number,
    coveredCount: number
  ): AnalysisSnapshot {
    const cg = emptyGraph();
    cg.functions = [
      ...Array.from({ length: testCount }, (_, i) =>
        fn(`__tests__/t${i}.test.ts`, `testFn${i}`, 2)
      ),
      ...Array.from({ length: prodCount }, (_, i) =>
        fn(`src/p${i}.ts`, `prodFn${i}`, 2)
      ),
    ];
    cg.calls = Array.from({ length: coveredCount }, (_, i) =>
      call(`__tests__/t0.test.ts`, "testFn0", `src/p${i}.ts`, `prodFn${i}`)
    );
    return snap({ codeGraph: cg });
  }

  it("computes percentage delta when both sides have tests", () => {
    // prev: 4/10 covered (40%), curr: 7/10 covered (70%)
    const prev = mkSnapWithCoverage(1, 10, 4);
    const curr = mkSnapWithCoverage(1, 10, 7);
    const diff = structuralDiff(prev, curr);
    expect(diff.coverageDelta).toEqual({
      fromPct: 40,
      toPct: 70,
      delta: 30,
    });
  });

  it("returns null when prev had no test files", () => {
    const prevCg = emptyGraph();
    prevCg.functions = [fn("src/a.ts", "foo", 5)];
    const curr = mkSnapWithCoverage(1, 5, 3);
    const diff = structuralDiff(snap({ codeGraph: prevCg }), curr);
    expect(diff.coverageDelta).toBeNull();
  });

  it("returns null when curr has no test files", () => {
    const prev = mkSnapWithCoverage(1, 5, 3);
    const currCg = emptyGraph();
    currCg.functions = [fn("src/a.ts", "foo", 5)];
    const diff = structuralDiff(prev, snap({ codeGraph: currCg }));
    expect(diff.coverageDelta).toBeNull();
  });
});

// ---------------- Complexity shifts ----------------

describe("structuralDiff · complexity shifts", () => {
  it("buckets files into worsened (positive delta) and improved (negative)", () => {
    const prevCg = emptyGraph();
    prevCg.fileComplexity = {
      "src/a.ts": 10,
      "src/b.ts": 20,
      "src/c.ts": 5,
    };
    const currCg = emptyGraph();
    currCg.fileComplexity = {
      "src/a.ts": 25, // +15 worsened
      "src/b.ts": 12, // -8 improved
      "src/c.ts": 5, // 0 = excluded
    };
    const diff = structuralDiff(
      snap({ codeGraph: prevCg }),
      snap({ codeGraph: currCg })
    );
    expect(diff.complexityWorsened).toEqual([
      { filePath: "src/a.ts", fromComplexity: 10, toComplexity: 25, delta: 15 },
    ]);
    expect(diff.complexityImproved).toEqual([
      { filePath: "src/b.ts", fromComplexity: 20, toComplexity: 12, delta: -8 },
    ]);
  });

  it("sorts each bucket by absolute delta size", () => {
    const prevCg = emptyGraph();
    prevCg.fileComplexity = { "a": 10, "b": 10, "c": 10 };
    const currCg = emptyGraph();
    currCg.fileComplexity = { "a": 15, "b": 30, "c": 12 }; // deltas: 5, 20, 2
    const diff = structuralDiff(
      snap({ codeGraph: prevCg }),
      snap({ codeGraph: currCg })
    );
    expect(diff.complexityWorsened.map((s) => s.filePath)).toEqual([
      "b",
      "a",
      "c",
    ]);
  });

  it("handles new files (only in curr) and removed files (only in prev)", () => {
    const prevCg = emptyGraph();
    prevCg.fileComplexity = { "removed.ts": 8 };
    const currCg = emptyGraph();
    currCg.fileComplexity = { "added.ts": 12 };
    const diff = structuralDiff(
      snap({ codeGraph: prevCg }),
      snap({ codeGraph: currCg })
    );
    expect(diff.complexityWorsened).toEqual([
      { filePath: "added.ts", fromComplexity: 0, toComplexity: 12, delta: 12 },
    ]);
    expect(diff.complexityImproved).toEqual([
      {
        filePath: "removed.ts",
        fromComplexity: 8,
        toComplexity: 0,
        delta: -8,
      },
    ]);
  });

  it("caps each bucket at 5 entries", () => {
    const prevCg = emptyGraph();
    const currCg = emptyGraph();
    for (let i = 0; i < 10; i++) {
      prevCg.fileComplexity[`f${i}.ts`] = 0;
      currCg.fileComplexity[`f${i}.ts`] = (i + 1) * 5; // all worsened
    }
    const diff = structuralDiff(
      snap({ codeGraph: prevCg }),
      snap({ codeGraph: currCg })
    );
    expect(diff.complexityWorsened).toHaveLength(5);
  });
});

// ---------------- Degraded mode ----------------

describe("structuralDiff · degraded mode", () => {
  it("returns a degraded result when prev has no codeGraph", () => {
    const diff = structuralDiff(
      snap({ codeGraph: undefined }),
      snap({ codeGraph: emptyGraph() })
    );
    expect(diff.degraded).toBeDefined();
    expect(diff.totalAdded).toBe(0);
    expect(diff.coverageDelta).toBeNull();
    expect(diff.fromFetchedAt).toBe("2026-05-06T00:00:00Z");
    expect(diff.toFetchedAt).toBe("2026-05-06T00:00:00Z");
  });

  it("returns a degraded result when curr has no codeGraph", () => {
    const diff = structuralDiff(
      snap({ codeGraph: emptyGraph() }),
      snap({ codeGraph: undefined })
    );
    expect(diff.degraded).toBeDefined();
  });

  it("preserves the timestamps even in degraded mode", () => {
    const diff = structuralDiff(
      snap({ fetchedAt: "2026-05-01T00:00:00Z", codeGraph: undefined }),
      snap({ fetchedAt: "2026-05-06T00:00:00Z", codeGraph: undefined })
    );
    expect(diff.fromFetchedAt).toBe("2026-05-01T00:00:00Z");
    expect(diff.toFetchedAt).toBe("2026-05-06T00:00:00Z");
  });
});

// ---------------- structuralDiffHasContent ----------------

describe("structuralDiffHasContent", () => {
  it("returns false on a fully-empty diff (no changes anywhere)", () => {
    const cg = emptyGraph();
    cg.functions = [fn("src/a.ts", "foo", 5)];
    const diff = structuralDiff(snap({ codeGraph: cg }), snap({ codeGraph: cg }));
    expect(structuralDiffHasContent(diff)).toBe(false);
  });

  it("returns true when there are added functions", () => {
    const prevCg = emptyGraph();
    const currCg = emptyGraph();
    currCg.functions = [fn("src/a.ts", "new", 5)];
    const diff = structuralDiff(
      snap({ codeGraph: prevCg }),
      snap({ codeGraph: currCg })
    );
    expect(structuralDiffHasContent(diff)).toBe(true);
  });

  it("returns true when there's a coverage delta", () => {
    function mkCovSnap(coveredCount: number): AnalysisSnapshot {
      const cg = emptyGraph();
      cg.functions = [
        fn("__tests__/t.test.ts", "testFn", 2),
        ...Array.from({ length: 10 }, (_, i) =>
          fn(`src/p${i}.ts`, `prodFn${i}`, 2)
        ),
      ];
      cg.calls = Array.from({ length: coveredCount }, (_, i) =>
        call(`__tests__/t.test.ts`, "testFn", `src/p${i}.ts`, `prodFn${i}`)
      );
      return snap({ codeGraph: cg });
    }
    const diff = structuralDiff(mkCovSnap(2), mkCovSnap(8));
    expect(structuralDiffHasContent(diff)).toBe(true);
  });

  it("returns false when coverage is unchanged across snapshots (v0.71)", () => {
    // diffCoverage returns a non-null CoverageDelta whenever both
    // sides have test infrastructure — even when the percentages are
    // identical. Pre-fix, that made the panel render against
    // unchanged repos (delta=0, all other fields zero) with an
    // empty SummaryStrip and no per-list rows. The gate must look
    // at delta !== 0, not the wrapper.
    function mkCovSnap(): AnalysisSnapshot {
      const cg = emptyGraph();
      cg.functions = [
        fn("__tests__/t.test.ts", "testFn", 2),
        fn("src/p.ts", "prodFn", 2),
      ];
      cg.calls = [call("__tests__/t.test.ts", "testFn", "src/p.ts", "prodFn")];
      return snap({ codeGraph: cg });
    }
    const diff = structuralDiff(mkCovSnap(), mkCovSnap());
    // CoverageDelta IS populated (both snapshots have tests)…
    expect(diff.coverageDelta).not.toBeNull();
    expect(diff.coverageDelta?.delta).toBe(0);
    // …but the panel should hide because nothing actually changed.
    expect(structuralDiffHasContent(diff)).toBe(false);
  });
});
