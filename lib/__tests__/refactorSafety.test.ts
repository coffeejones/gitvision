// Coverage for the refactor-safety data layer (lib/refactorSafety.ts).

import { describe, it, expect } from "vitest";
import { computeRefactorSafety } from "../refactorSafety";
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

describe("computeRefactorSafety", () => {
  it("counts distinct dependents, excluding self-edges and test targets", () => {
    const cg = graph({
      imports: [
        { from: "src/a.ts", to: "src/core.ts", kind: "import" },
        { from: "src/b.ts", to: "src/core.ts", kind: "import" },
        { from: "src/b.ts", to: "src/core.ts", kind: "import" }, // dup source
        { from: "src/core.ts", to: "src/core.ts", kind: "import" }, // self — ignored
      ],
      calls: [
        { fromFile: "src/c.ts", toFile: "src/core.ts", calleeName: "f", fromFunction: null, toFunction: "f" },
        // a test file depending on core doesn't inflate — but core is the
        // target here, not the test; the test IS a dependent though:
        { fromFile: "src/core.test.ts", toFile: "src/core.ts", calleeName: "f", fromFunction: null, toFunction: "f" },
      ],
      fileComplexity: { "src/core.ts": 10 },
    });
    const report = computeRefactorSafety(cg);
    const core = report.files.find((f) => f.file === "src/core.ts");
    expect(core).toBeDefined();
    // a, b, c, and the test file = 4 distinct dependents
    expect(core!.dependents).toBe(4);
    // core.test.ts reaches core → core itself is tested
    expect(core!.tested).toBe(true);
  });

  it("does not score test files themselves", () => {
    const cg = graph({
      imports: [{ from: "src/app.test.ts", to: "src/app.ts", kind: "import" }],
      fileComplexity: { "src/app.test.ts": 20, "src/app.ts": 5 },
    });
    const report = computeRefactorSafety(cg);
    expect(report.files.some((f) => f.file === "src/app.test.ts")).toBe(false);
    expect(report.files.some((f) => f.file === "src/app.ts")).toBe(true);
  });

  it("counts untested dependents and samples them for high tiers", () => {
    // core has 9 dependents; 4 are guarded by a test, 5 are not.
    const imports = [] as CodeGraph["imports"];
    for (let i = 0; i < 9; i++) {
      imports.push({ from: `src/dep${i}.ts`, to: "src/core.ts", kind: "import" });
    }
    // dep0..dep3 are reached by a test → tested
    for (let i = 0; i < 4; i++) {
      imports.push({ from: "src/core.test.ts", to: `src/dep${i}.ts`, kind: "import" });
    }
    const cg = graph({ imports, fileComplexity: { "src/core.ts": 5 } });
    const report = computeRefactorSafety(cg);
    const core = report.files.find((f) => f.file === "src/core.ts")!;
    expect(core.dependents).toBe(9);
    expect(core.untestedDependents).toBe(5); // dep4..dep8
    // 9 dependents + 5 untested → load-bearing → sample populated
    expect(core.tier).toBe("load-bearing");
    expect(core.untestedDependentSample.length).toBe(5);
  });

  it("classifies tiers from the evidence", () => {
    const cg = graph({
      imports: [
        // hub: 8 dependents, none tested → load-bearing
        ...Array.from({ length: 8 }, (_, i) => ({ from: `src/u${i}.ts`, to: "src/hub.ts", kind: "import" as const })),
        // mid: 3 dependents, one untested + moderate complexity → handle-with-care
        { from: "src/m1.ts", to: "src/mid.ts", kind: "import" },
        { from: "src/m2.ts", to: "src/mid.ts", kind: "import" },
        { from: "src/m3.ts", to: "src/mid.ts", kind: "import" },
        // leaf: 1 dependent → moderate
        { from: "src/x.ts", to: "src/leaf.ts", kind: "import" },
      ],
      fileComplexity: { "src/mid.ts": 22, "src/solo.ts": 2 },
    });
    const report = computeRefactorSafety(cg);
    const tierOf = (f: string) => report.files.find((x) => x.file === f)?.tier;
    expect(tierOf("src/hub.ts")).toBe("load-bearing");
    expect(tierOf("src/mid.ts")).toBe("handle-with-care");
    expect(tierOf("src/leaf.ts")).toBe("moderate");
    // solo.ts is real code (complexity 2) but has no dependents → listed as
    // safe (the UI collapses the safe tier; the data layer stays complete).
    expect(tierOf("src/solo.ts")).toBe("safe");
  });

  it("flags duplicated functions per file", () => {
    const cg = graph({
      functions: [
        { filePath: "src/a.ts", name: "fmt", startRow: 1, endRow: 9, complexity: 6, bodyHash: "H1" },
        { filePath: "src/b.ts", name: "format", startRow: 1, endRow: 9, complexity: 6, bodyHash: "H1" },
        { filePath: "src/c.ts", name: "unique", startRow: 1, endRow: 3, complexity: 6, bodyHash: "H2" },
      ],
      fileComplexity: { "src/a.ts": 6, "src/b.ts": 6, "src/c.ts": 6 },
    });
    const report = computeRefactorSafety(cg);
    expect(report.files.find((f) => f.file === "src/a.ts")!.duplicatedFns).toBe(1);
    expect(report.files.find((f) => f.file === "src/b.ts")!.duplicatedFns).toBe(1);
    expect(report.files.find((f) => f.file === "src/c.ts")!.duplicatedFns).toBe(0);
  });

  it("ranks tests that guard the affected set only when withTests is set", () => {
    const imports = [] as CodeGraph["imports"];
    for (let i = 0; i < 8; i++) {
      imports.push({ from: `src/d${i}.ts`, to: "src/hub.ts", kind: "import" });
    }
    // hub.test.ts guards hub + d0 + d1 + d2 (4 of the affected set)
    for (const t of ["src/hub.ts", "src/d0.ts", "src/d1.ts", "src/d2.ts"]) {
      imports.push({ from: "src/hub.test.ts", to: t, kind: "import" });
    }
    // d5.test.ts guards just d5
    imports.push({ from: "src/d5.test.ts", to: "src/d5.ts", kind: "import" });
    const cg = graph({ imports });

    const withTests = computeRefactorSafety(cg, { withTests: true });
    const hub = withTests.files.find((f) => f.file === "src/hub.ts")!;
    expect(hub.tier).toBe("load-bearing");
    expect(hub.testsToRun?.[0]).toEqual({ file: "src/hub.test.ts", guards: 4 });
    expect(
      hub.testsToRun?.some((t) => t.file === "src/d5.test.ts" && t.guards === 1)
    ).toBe(true);

    // The default (free) view never computes/ships the prioritizer data.
    const free = computeRefactorSafety(cg);
    expect(free.files.find((f) => f.file === "src/hub.ts")!.testsToRun).toBeUndefined();
  });

  it("returns per-tier counts and sorts most load-bearing first", () => {
    const cg = graph({
      imports: [
        ...Array.from({ length: 10 }, (_, i) => ({ from: `src/d${i}.ts`, to: "src/hub.ts", kind: "import" as const })),
        { from: "src/x.ts", to: "src/leaf.ts", kind: "import" },
      ],
    });
    const report = computeRefactorSafety(cg);
    expect(report.counts["load-bearing"]).toBeGreaterThanOrEqual(1);
    expect(report.files[0].file).toBe("src/hub.ts"); // highest rank first
    expect(report.totalFiles).toBe(report.files.length);
  });
});
