import { describe, it, expect } from "vitest";
import type { CodeGraph } from "../codeAnalysis/types";
import type { AnalysisSnapshot } from "../types";
import {
  computeFileChips,
  functionMarkersFor,
  complexityTone,
  duplicateIndex,
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

describe("functionMarkersFor · since last visit", () => {
  const cur = graph({
    contentHashes: { "a.ts": "h" },
    functions: [
      { filePath: "a.ts", name: "keep", startRow: 0, endRow: 5, complexity: 3, bodyHash: "AA" },
      { filePath: "a.ts", name: "touched", startRow: 10, endRow: 15, complexity: 3, bodyHash: "BB2" },
      { filePath: "a.ts", name: "fresh", startRow: 20, endRow: 25, complexity: 3, bodyHash: "CC" },
      { filePath: "a.ts", name: "noHash", startRow: 30, endRow: 32, complexity: 2 },
    ],
  });
  const prev = graph({
    functions: [
      { filePath: "a.ts", name: "keep", startRow: 0, endRow: 5, complexity: 3, bodyHash: "AA" },
      { filePath: "a.ts", name: "touched", startRow: 10, endRow: 15, complexity: 3, bodyHash: "BB1" },
      { filePath: "a.ts", name: "noHash", startRow: 30, endRow: 32, complexity: 2 },
    ],
  });

  it("tags new / modified / unchanged vs the previous graph", () => {
    const m = Object.fromEntries(
      functionMarkersFor(cur, "a.ts", prev).map((f) => [f.name, f.changed]),
    );
    expect(m.keep).toBeUndefined(); // same body hash
    expect(m.touched).toBe("modified"); // body hash moved
    expect(m.fresh).toBe("new"); // didn't exist before
    expect(m.noHash).toBeUndefined(); // no hash on either side — not a false "modified"
  });

  it("tags nothing when there is no previous graph", () => {
    expect(functionMarkersFor(cur, "a.ts").every((f) => f.changed === undefined)).toBe(true);
  });
});

describe("duplicate navigation", () => {
  const dcg = graph({
    contentHashes: { "a.ts": "1", "b.ts": "2", "c.ts": "3" },
    functions: [
      // Complexity >= 5 (findDuplicateGroups' floor — trivial one-liners are ignored).
      { filePath: "a.ts", name: "f", startRow: 4, endRow: 8, complexity: 6, bodyHash: "DUP" },
      { filePath: "b.ts", name: "g", startRow: 10, endRow: 14, complexity: 6, bodyHash: "DUP" },
      { filePath: "c.ts", name: "h", startRow: 0, endRow: 2, complexity: 6, bodyHash: "DUP" },
      { filePath: "a.ts", name: "unique", startRow: 20, endRow: 22, complexity: 6, bodyHash: "UNIQ" },
    ],
  });

  it("indexes groups of >=2 by body hash, skipping singletons", () => {
    const idx = duplicateIndex(dcg);
    expect(idx.get("DUP")?.length).toBe(3);
    expect(idx.get("UNIQ")).toBeUndefined();
  });

  it("attaches each function's twins (other members, self excluded, as file:line)", () => {
    const markers = functionMarkersFor(dcg, "a.ts", null, duplicateIndex(dcg));
    const f = markers.find((m) => m.name === "f");
    expect(f?.duplicates).toHaveLength(2);
    expect(f?.duplicates).toEqual(
      expect.arrayContaining([
        { path: "b.ts", line: 11 },
        { path: "c.ts", line: 1 },
      ]),
    );
    expect(markers.find((m) => m.name === "unique")?.duplicates).toBeUndefined();
  });

  it("attaches nothing without a duplicate index", () => {
    expect(functionMarkersFor(dcg, "a.ts").every((m) => m.duplicates === undefined)).toBe(true);
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
