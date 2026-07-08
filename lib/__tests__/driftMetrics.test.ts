// Coverage for the drift-metrics fingerprint (lib/driftMetrics.ts).

import { describe, it, expect } from "vitest";
import { computeDriftMetrics } from "../driftMetrics";
import type { CodeGraph } from "../codeAnalysis/types";

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
