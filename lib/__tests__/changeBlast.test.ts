// Coverage for the change-blast engine (lib/changeBlast/compute.ts).

import { describe, it, expect } from "vitest";
import type { AnalysisSnapshot } from "../types";
import type { CodeGraph } from "../codeAnalysis/types";
import { computeChangeBlast } from "../changeBlast/compute";

type FileSpec = { fns: Array<[string, string, number?]>; imports?: string[] };

function mkGraph(spec: Record<string, FileSpec>): CodeGraph {
  const functions: unknown[] = [];
  const imports: unknown[] = [];
  const fileComplexity: Record<string, number> = {};
  for (const [file, { fns, imports: imps }] of Object.entries(spec)) {
    let cx = 0;
    for (const [name, hash, c] of fns) {
      const complexity = c ?? 3;
      functions.push({ filePath: file, name, startRow: 1, endRow: 2, complexity, bodyHash: hash });
      cx += complexity;
    }
    fileComplexity[file] = cx;
    for (const to of imps ?? []) imports.push({ from: file, to });
  }
  return {
    functions,
    calls: [],
    imports,
    fileComplexity,
    filesByExt: {},
    byPlugin: {},
    generatedAt: "",
  } as unknown as CodeGraph;
}

function snap(codeGraph: CodeGraph | undefined): AnalysisSnapshot {
  return { fetchedAt: "2026-07-10T00:00:00Z", codeGraph } as unknown as AnalysisSnapshot;
}

// 10 files import src/core.ts → fan-in 10 → load-bearing.
const deps: Record<string, FileSpec> = {};
for (let i = 0; i < 10; i++) {
  deps[`src/dep${i}.ts`] = { fns: [[`d${i}`, `DEP${i}`]], imports: ["src/core.ts"] };
}

const commonBase: Record<string, FileSpec> = {
  "src/core.ts": { fns: [["coreFn", "CORE_V1", 12]] },
  "src/util.ts": { fns: [["utilFn", "UTIL_V1", 5]] },
  "src/old.ts": { fns: [["oldFn", "OLD", 4]] },
  "src/a.ts": { fns: [["a", "A"]], imports: ["src/util.ts"] },
  "src/b.ts": { fns: [["b", "B"]], imports: ["src/util.ts"] },
  ...deps,
};

const base = mkGraph({
  ...commonBase,
  "src/core.test.ts": { fns: [["testCore", "TEST_V1"]], imports: ["src/core.ts"] },
});

// Head: core.ts modified, old.ts removed, new.ts added.
function head(coreTestHash: string): CodeGraph {
  return mkGraph({
    "src/core.ts": { fns: [["coreFn", "CORE_V2", 12]] }, // modified body
    "src/util.ts": { fns: [["utilFn", "UTIL_V1", 5]] }, // unchanged
    "src/new.ts": { fns: [["newFn", "NEW", 4]] }, // added
    "src/a.ts": { fns: [["a", "A"]], imports: ["src/util.ts"] },
    "src/b.ts": { fns: [["b", "B"]], imports: ["src/util.ts"] },
    ...deps,
    "src/core.test.ts": { fns: [["testCore", coreTestHash]], imports: ["src/core.ts"] },
  });
}

describe("computeChangeBlast", () => {
  it("maps the diff onto tiers, walls, and guarding tests (test updated → review)", () => {
    const r = computeChangeBlast(snap(base), snap(head("TEST_V2"))); // test file changed too
    expect(r.hasGraphs).toBe(true);

    const byFile = new Map(r.changedFiles.map((c) => [c.file, c]));
    expect([...byFile.keys()].sort()).toEqual([
      "src/core.test.ts",
      "src/core.ts",
      "src/new.ts",
      "src/old.ts",
    ]);
    expect(byFile.get("src/core.ts")!.kind).toBe("modified");
    expect(byFile.get("src/core.ts")!.tier).toBe("load-bearing");
    expect(byFile.get("src/new.ts")!.kind).toBe("added");
    expect(byFile.get("src/old.ts")!.kind).toBe("removed");

    expect(r.loadBearingTouched).toContain("src/core.ts");
    expect(r.testFilesChanged).toBe(1); // core.test.ts
    // core.ts is guarded by core.test.ts, which IS in the diff
    expect(r.testsToRun).toContain("src/core.test.ts");
    expect(r.mappedTestsUpdated).toBe(1);
    expect(r.verdict).toBe("review");
    expect(r.headline).toMatch(/1 load-bearing wall/);
  });

  it("flags high-risk when a load-bearing wall changes but the diff updates no tests", () => {
    const r = computeChangeBlast(snap(base), snap(head("TEST_V1"))); // test file unchanged
    expect(r.testFilesChanged).toBe(0);
    expect(r.loadBearingTouched).toContain("src/core.ts");
    expect(r.verdict).toBe("high-risk");
    expect(r.mappedTestsUpdated).toBe(0);
  });

  it("ranks production files ahead of tests, load-bearing first", () => {
    const r = computeChangeBlast(snap(base), snap(head("TEST_V2")));
    expect(r.changedFiles[0].file).toBe("src/core.ts"); // load-bearing prod file leads
    expect(r.changedFiles[r.changedFiles.length - 1].isTest).toBe(true); // test last
  });

  it("returns a clean report when nothing changed", () => {
    const r = computeChangeBlast(snap(base), snap(base));
    expect(r.hasGraphs).toBe(true);
    expect(r.changedFiles).toEqual([]);
    expect(r.verdict).toBe("clear");
  });

  it("degrades gracefully when a code graph is missing", () => {
    const r = computeChangeBlast(snap(base), snap(undefined));
    expect(r.hasGraphs).toBe(false);
    expect(r.verdict).toBe("clear");
  });
});
