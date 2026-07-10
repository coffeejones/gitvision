// computeWeakSuite tiering + totals + Plus-gated detail (Arc 1). Pure over a
// synthetic CodeGraph.testFiles — no plugin/parse involved.

import { describe, it, expect } from "vitest";
import { computeWeakSuite, weakSuiteSummary } from "../weakSuite";
import type { CodeGraph, TestFileGraphEntry } from "../codeAnalysis/types";

/** Build a test-file entry from a compact case spec. A case is smoke-only when
 *  it has 0 assertions or no meaningful oracle. */
function tf(
  file: string,
  cases: Array<{ a: number; meaningful: boolean }>,
): TestFileGraphEntry {
  return {
    file,
    cases: cases.map((c, i) => ({
      name: `case ${i}`,
      line: i + 1,
      assertions: c.a,
      trivialAssertions: c.meaningful ? 0 : c.a,
      hasMeaningfulOracle: c.meaningful,
    })),
    trivialOracleNames: [],
  };
}

function graph(testFiles?: TestFileGraphEntry[]): CodeGraph {
  return {
    functions: [],
    calls: [],
    imports: [],
    fileComplexity: {},
    filesByExt: {},
    byPlugin: {},
    testFiles,
    generatedAt: "",
  } as unknown as CodeGraph;
}

const HOLLOW = tf("src/hollow.test.ts", [
  { a: 1, meaningful: true },
  { a: 1, meaningful: false },
  { a: 0, meaningful: false },
  { a: 1, meaningful: false },
]); // 3/4 smoke → hollow
const THIN = tf("src/thin.test.ts", [
  { a: 2, meaningful: true },
  { a: 2, meaningful: true },
  { a: 2, meaningful: true },
  { a: 2, meaningful: true },
  { a: 1, meaningful: false },
]); // 1/5 = 0.2 smoke → thin
const SOLID = tf("src/solid.test.ts", [
  { a: 2, meaningful: true },
  { a: 2, meaningful: true },
  { a: 2, meaningful: true },
  { a: 2, meaningful: true },
  { a: 2, meaningful: true },
]); // 0 smoke, density 2 → solid

describe("computeWeakSuite", () => {
  it("tiers each file by smoke-only ratio and ranks worst-first", () => {
    const r = computeWeakSuite(graph([SOLID, THIN, HOLLOW]))!;
    expect(r.counts).toEqual({ hollow: 1, thin: 1, solid: 1 });
    expect(r.files.map((f) => f.tier)).toEqual(["hollow", "thin", "solid"]);
    const hollow = r.files.find((f) => f.file === "src/hollow.test.ts")!;
    expect(hollow).toMatchObject({ tier: "hollow", testCases: 4, smokeOnlyCases: 3, smokeOnlyRatio: 0.75 });
  });

  it("computes repo-wide totals", () => {
    const r = computeWeakSuite(graph([SOLID, THIN, HOLLOW]))!;
    expect(r.totals).toEqual({
      testFiles: 3,
      testCases: 14,
      assertions: 22,
      smokeOnlyCases: 4,
      assertionDensity: 1.57,
      smokeOnlyRatio: 0.29,
    });
  });

  it("omits per-case detail unless withDetail (the Plus gate)", () => {
    const free = computeWeakSuite(graph([HOLLOW]))!;
    expect(free.files[0].cases).toBeUndefined();
    const plus = computeWeakSuite(graph([HOLLOW]), { withDetail: true })!;
    expect(plus.files[0].cases).toHaveLength(4);
  });

  it("returns null when the graph has no test-file metadata", () => {
    expect(computeWeakSuite(graph(undefined))).toBeNull();
    expect(computeWeakSuite(graph([]))).toBeNull();
  });

  it("summary carries only counts + totals (no file list)", () => {
    const r = computeWeakSuite(graph([HOLLOW, SOLID]));
    const summary = weakSuiteSummary(r)!;
    expect(summary).toEqual({ counts: r!.counts, totals: r!.totals });
    expect(summary).not.toHaveProperty("files");
    expect(weakSuiteSummary(null)).toBeUndefined();
  });
});
