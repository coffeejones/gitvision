// Coverage for the drift-metrics fingerprint (lib/driftMetrics.ts).

import { describe, it, expect } from "vitest";
import {
  computeDriftMetrics,
  computeDriftTrends,
  type DriftMetrics,
} from "../driftMetrics";
import type { CodeGraph } from "../codeAnalysis/types";

/** A full metrics fingerprint with sensible defaults, overridable per field. */
function metrics(over: Partial<DriftMetrics> = {}): DriftMetrics {
  return {
    files: 10,
    functions: 100,
    avgComplexity: 5,
    maxComplexity: 30,
    duplicationPct: 10,
    prodFnCoveragePct: 80,
    connectivity: 1,
    ...over,
  };
}

/** A snapshot carrying a persisted fingerprint. */
function snap(at: string, m: DriftMetrics) {
  return { fetchedAt: at, driftMetrics: m };
}

function graph(partial: Partial<CodeGraph>): CodeGraph {
  return {
    functions: [],
    calls: [],
    imports: [],
    fileComplexity: {},
    filesByExt: {},
    byPlugin: {},
    generatedAt: "",
    ...partial,
  } as CodeGraph;
}

describe("computeDriftMetrics", () => {
  it("computes the fingerprint from the code graph", () => {
    const cg = graph({
      functions: [
        // fn1 + fn3 are a structural duplicate group (same hash, complexity >=5)
        { filePath: "src/a.ts", name: "fn1", startRow: 1, endRow: 9, complexity: 6, bodyHash: "H1" },
        { filePath: "src/a.ts", name: "fn2", startRow: 11, endRow: 14, complexity: 3, bodyHash: "H2" },
        { filePath: "src/b.ts", name: "fn3", startRow: 1, endRow: 9, complexity: 6, bodyHash: "H1" },
      ],
      calls: [
        // a test file covers fn1 (direct test caller)
        { fromFile: "src/a.test.ts", fromFunction: null, calleeName: "fn1", toFile: "src/a.ts", toFunction: "fn1" },
        // fn2 → fn1 (a non-test resolved call)
        { fromFile: "src/a.ts", fromFunction: "fn2", calleeName: "fn1", toFile: "src/a.ts", toFunction: "fn1" },
      ],
      fileComplexity: { "src/a.ts": 9, "src/b.ts": 6 },
    });

    const m = computeDriftMetrics(cg);
    expect(m.files).toBe(2);
    expect(m.functions).toBe(3);
    expect(m.avgComplexity).toBe(7.5); // (9 + 6) / 2
    expect(m.maxComplexity).toBe(9);
    // fn1 + fn3 duplicated out of 3 functions
    expect(m.duplicationPct).toBe(66.7);
    // only fn1 has a test caller, of 3 prod functions
    expect(m.prodFnCoveragePct).toBe(33.3);
    // 2 resolved calls / 3 functions
    expect(m.connectivity).toBe(0.67);
  });

  it("returns zeros for an empty graph without dividing by zero", () => {
    const m = computeDriftMetrics(graph({}));
    expect(m).toEqual({
      files: 0,
      functions: 0,
      avgComplexity: 0,
      maxComplexity: 0,
      duplicationPct: 0,
      prodFnCoveragePct: 0,
      connectivity: 0,
    });
  });
});

describe("computeDriftTrends", () => {
  it("has no baseline until 2 measurable snapshots exist", () => {
    expect(computeDriftTrends([]).hasBaseline).toBe(false);
    const one = computeDriftTrends([snap("2026-01-01", metrics())]);
    expect(one.hasBaseline).toBe(false);
    expect(one.sweeps).toBe(1);
    expect(one.trends).toEqual([]);
  });

  it("diffs earliest → latest and reports the movements worst-first", () => {
    const report = computeDriftTrends([
      snap("2026-01-01", metrics({ duplicationPct: 10, prodFnCoveragePct: 80 })),
      snap("2026-02-01", metrics()), // middle sweep is ignored for the span
      snap(
        "2026-03-01",
        metrics({ duplicationPct: 44, prodFnCoveragePct: 60 })
      ),
    ]);

    expect(report.hasBaseline).toBe(true);
    expect(report.sweeps).toBe(3);
    expect(report.baselineAt).toBe("2026-01-01");
    expect(report.latestAt).toBe("2026-03-01");
    // raw endpoint fingerprints exposed for the share card
    expect(report.baseline?.duplicationPct).toBe(10);
    expect(report.latest?.duplicationPct).toBe(44);

    // duplication +34 and coverage -20 both moved; both are regressions, so
    // they sort by magnitude → duplication first.
    expect(report.trends.map((t) => t.key)).toEqual([
      "duplicationPct",
      "prodFnCoveragePct",
    ]);
    const dup = report.trends[0];
    expect(dup).toMatchObject({ from: 10, to: 44, delta: 34, worse: true, unit: "%" });
    const cov = report.trends[1];
    expect(cov).toMatchObject({ from: 80, to: 60, delta: -20, worse: true });
  });

  it("ignores movements below the per-metric noise floor", () => {
    // avgComplexity +0.2 (floor 0.5) and maxComplexity +1 (floor 2) are noise.
    const report = computeDriftTrends([
      snap("2026-01-01", metrics({ avgComplexity: 5, maxComplexity: 30 })),
      snap("2026-02-01", metrics({ avgComplexity: 5.2, maxComplexity: 31 })),
    ]);
    expect(report.trends).toEqual([]);
  });

  it("sorts regressions ahead of improvements regardless of magnitude", () => {
    const report = computeDriftTrends([
      snap("2026-01-01", metrics({ duplicationPct: 10, prodFnCoveragePct: 50 })),
      snap("2026-02-01", metrics({ duplicationPct: 15, prodFnCoveragePct: 65 })),
    ]);
    // duplication +5 (worse) sorts before coverage +15 (better).
    expect(report.trends.map((t) => t.key)).toEqual([
      "duplicationPct",
      "prodFnCoveragePct",
    ]);
    expect(report.trends[0].worse).toBe(true);
    expect(report.trends[1].worse).toBe(false);
  });

  it("computes metrics on the fly for snapshots lacking a persisted fingerprint", () => {
    // Baseline has only a code graph (pre-fingerprint snapshot); it must still
    // contribute to the trend rather than being skipped.
    const baseline = {
      fetchedAt: "2026-01-01",
      codeGraph: graph({
        functions: [
          { filePath: "src/a.ts", name: "fn1", startRow: 1, endRow: 9, complexity: 6, bodyHash: "H1" },
        ],
        fileComplexity: { "src/a.ts": 6 },
      }),
    };
    const latest = snap("2026-02-01", metrics({ duplicationPct: 50 }));
    const report = computeDriftTrends([baseline, latest]);
    expect(report.hasBaseline).toBe(true);
    expect(report.sweeps).toBe(2);
    // baseline has 0% duplication (1 lone function), latest 50% → +50 regression
    expect(report.trends[0]).toMatchObject({
      key: "duplicationPct",
      from: 0,
      to: 50,
      worse: true,
    });
  });
});
