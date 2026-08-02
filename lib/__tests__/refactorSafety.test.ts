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

// The Test Prioritizer's ranking. Measured against a mutation oracle
// (bench/mutationOracle.ts, 20 files x 3 mutants): ranking on `guards` alone
// put 5 of the 6 tests that ACTUALLY caught a break below the cap of 6.
// Recall against that oracle went 0.727 -> 0.864 when these two rungs were
// added. Both counter-cases below are real files from this repo.
describe("computeRefactorSafety — which tests to run, in what order", () => {
  /** A file with enough fan-in and complexity to reach a high tier, plus a
   *  crowd of test files that all import it directly. */
  function crowded(target: string, tests: string[]): CodeGraph {
    const imports = [
      // Eight non-test dependents: enough fan-in for the high tier.
      ...Array.from({ length: 8 }, (_, i) => ({
        from: `src/dep${i}.ts`, to: target, kind: "import" as const,
      })),
      ...tests.map((t) => ({ from: t, to: target, kind: "import" as const })),
    ];
    return graph({ imports, fileComplexity: { [target]: 40 } });
  }

  it("puts the test named after the file first, not the broadest one", () => {
    // testCoverage.test.ts was ranked OUT of the top 6 for testCoverage.ts —
    // the most obvious guarding test there is, beaten by tests that touch more
    // files and catch nothing.
    const cg = crowded("lib/testCoverage.ts", [
      "lib/__tests__/aaa.test.ts",
      "lib/__tests__/bbb.test.ts",
      "lib/__tests__/ccc.test.ts",
      "lib/__tests__/ddd.test.ts",
      "lib/__tests__/eee.test.ts",
      "lib/__tests__/fff.test.ts",
      "lib/__tests__/testCoverage.test.ts",
    ]);
    const f = computeRefactorSafety(cg, { withTests: true })
      .files.find((x) => x.file === "lib/testCoverage.ts");
    expect(f?.testsToRun?.[0]?.file).toBe("lib/__tests__/testCoverage.test.ts");
  });

  it("keeps a prefix-named test when the field is alphabetically stacked against it", () => {
    // storage.ts: 20 candidates all importing it directly, so direct-reach
    // cannot discriminate and the order fell back to alphabetical — badgeRoute,
    // demoHighlights, evidenceRoute won on their first letter while
    // storageDeleteByInstallation sat below the cut. It was 0 of 2.
    const cg = crowded("lib/storage.ts", [
      "lib/__tests__/badgeRoute.test.ts",
      "lib/__tests__/demoHighlights.test.ts",
      "lib/__tests__/evidenceRoute.test.ts",
      "lib/__tests__/explainRoute.test.ts",
      "lib/__tests__/sbomRoute.test.ts",
      "lib/__tests__/sourceRoute.test.ts",
      "lib/__tests__/storageDeleteByInstallation.test.ts",
    ]);
    const listed = computeRefactorSafety(cg, { withTests: true })
      .files.find((x) => x.file === "lib/storage.ts")
      ?.testsToRun?.map((t) => t.file) ?? [];
    expect(listed).toContain("lib/__tests__/storageDeleteByInstallation.test.ts");
  });

  it("still caps the list — ten is the budget, not a suggestion", () => {
    // Ten is the knee of the measured curve, not a round number: six recovers
    // 0.818 of the tests that actually catch a break on this repo, ten
    // recovers 0.955, and twenty adds nothing further.
    const cg = crowded("lib/core.ts", Array.from({ length: 25 }, (_, i) =>
      `lib/__tests__/t${String(i).padStart(2, "0")}.test.ts`));
    const f = computeRefactorSafety(cg, { withTests: true })
      .files.find((x) => x.file === "lib/core.ts");
    expect(f?.testsToRun?.length).toBe(10);
  });
});

describe("computeRefactorSafety — test naming conventions across languages", () => {
  it("matches Python's test_<name>.py, not just JS's <name>.test.ts", () => {
    // The affinity rung compared basenames after stripping a TRAILING .test /
    // .spec, so `test_blueprints` never matched `blueprints` and the rung was
    // dead on every Python repo. Measured on Flask.
    const imports = [
      ...Array.from({ length: 8 }, (_, i) => ({
        from: `src/pkg/dep${i}.py`, to: "src/pkg/blueprints.py", kind: "import" as const,
      })),
      ...["aaa", "bbb", "ccc", "ddd", "eee", "fff"].map((n) => ({
        from: `tests/test_${n}.py`, to: "src/pkg/blueprints.py", kind: "import" as const,
      })),
      { from: "tests/test_blueprints.py", to: "src/pkg/blueprints.py", kind: "import" as const },
    ];
    const cg = graph({ imports, fileComplexity: { "src/pkg/blueprints.py": 40 } });
    const f = computeRefactorSafety(cg, { withTests: true })
      .files.find((x) => x.file === "src/pkg/blueprints.py");
    expect(f?.testsToRun?.[0]?.file).toBe("tests/test_blueprints.py");
  });

  it("never offers a conftest or a fixture app as a test to run", () => {
    const imports = [
      ...Array.from({ length: 8 }, (_, i) => ({
        from: `src/pkg/dep${i}.py`, to: "src/pkg/core.py", kind: "import" as const,
      })),
      { from: "tests/conftest.py", to: "src/pkg/core.py", kind: "import" as const },
      { from: "tests/test_apps/fixture/__init__.py", to: "src/pkg/core.py", kind: "import" as const },
      { from: "tests/test_core.py", to: "src/pkg/core.py", kind: "import" as const },
    ];
    const cg = graph({ imports, fileComplexity: { "src/pkg/core.py": 40 } });
    const listed = computeRefactorSafety(cg, { withTests: true })
      .files.find((x) => x.file === "src/pkg/core.py")
      ?.testsToRun?.map((t) => t.file) ?? [];
    expect(listed).toEqual(["tests/test_core.py"]);
  });
});
