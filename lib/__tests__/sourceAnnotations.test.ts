import { describe, it, expect } from "vitest";
import type { CodeGraph } from "../codeAnalysis/types";
import type { AnalysisSnapshot } from "../types";
import {
  computeFileChips,
  functionMarkersFor,
  complexityTone,
} from "../sourceAnnotations";

function graph(partial: Partial<CodeGraph>): CodeGraph {
  return {
    functions: [],
    calls: [],
    imports: [],
    fileComplexity: {},
    filesByExt: {},
    byPlugin: {},
    generatedAt: "2026-07-14T00:00:00.000Z",
    ...partial,
  } as CodeGraph;
}

const CG = graph({
  contentHashes: { "src/core.ts": "h1", "src/app.ts": "h2", "src/app.test.ts": "h3" },
  functions: [
    { filePath: "src/core.ts", name: "load", startRow: 4, endRow: 40, complexity: 16 },
    { filePath: "src/core.ts", name: "trivial", startRow: 50, endRow: 52, complexity: 2 },
    { filePath: "src/app.ts", name: "main", startRow: 0, endRow: 10, complexity: 9 },
  ],
  imports: [
    { from: "src/app.ts", to: "src/core.ts", kind: "import" },
    { from: "src/app.test.ts", to: "src/app.ts", kind: "import" },
  ],
  fileComplexity: { "src/core.ts": 18, "src/app.ts": 9, "src/app.test.ts": 5 },
});

const SNAP = {
  codeGraph: CG,
  hotspots: [
    {
      path: "src/core.ts",
      churn: 42,
      authors: 1,
      authorLogins: ["solo"],
      lastModified: "2026-07-01T00:00:00.000Z",
      score: 0.9,
      commits: [],
    },
  ],
} as unknown as AnalysisSnapshot;

describe("computeFileChips", () => {
  const chips = computeFileChips(SNAP);

  it("emits one entry per analyzed file", () => {
    expect(Object.keys(chips).sort()).toEqual(["src/app.test.ts", "src/app.ts", "src/core.ts"]);
  });

  it("maps hotspot churn + authors onto the file", () => {
    expect(chips["src/core.ts"]).toMatchObject({ churn: 42, authors: 1, isTest: false });
  });

  it("leaves churn/authors null for a file with no git hotspot", () => {
    expect(chips["src/app.ts"]).toMatchObject({ churn: null, authors: null });
  });

  it("flags a test file via isTest", () => {
    expect(chips["src/app.test.ts"].isTest).toBe(true);
    expect(chips["src/core.ts"].isTest).toBe(false);
  });

  it("carries fan-in from the safety pass (app.ts imports core.ts)", () => {
    expect(chips["src/core.ts"].fanIn).toBeGreaterThanOrEqual(1);
  });

  it("returns {} for a snapshot with no code graph", () => {
    expect(computeFileChips({} as AnalysisSnapshot)).toEqual({});
  });
});

describe("functionMarkersFor", () => {
  it("returns only the functions in the given file, with rows + complexity", () => {
    const fns = functionMarkersFor(CG, "src/core.ts");
    expect(fns).toEqual([
      { name: "load", startRow: 4, endRow: 40, complexity: 16 },
      { name: "trivial", startRow: 50, endRow: 52, complexity: 2 },
    ]);
  });

  it("returns [] for a file with no functions", () => {
    expect(functionMarkersFor(CG, "src/app.test.ts")).toEqual([]);
  });
});

describe("complexityTone", () => {
  it("marks high at >=15, medium at 8-14, nothing below 8", () => {
    expect(complexityTone(20)).toBe("high");
    expect(complexityTone(15)).toBe("high");
    expect(complexityTone(14)).toBe("medium");
    expect(complexityTone(8)).toBe("medium");
    expect(complexityTone(7)).toBe(null);
    expect(complexityTone(1)).toBe(null);
  });
});
