// Tests for the v0.29 test-to-code mapping primitives:
//   - isTestFile: convention-based path classification across languages
//   - computeTestCoverage: per-file aggregation + untested-hotspots
//
// Pure functions, fixture-driven — no GitHub round-trips.

import { describe, it, expect } from "vitest";
import {
  isTestFile,
  computeTestCoverage,
} from "../codeAnalysis/testCoverage";
import type { CodeGraph } from "../codeAnalysis/types";

function emptyCodeGraph(): CodeGraph {
  return {
    functions: [],
    calls: [],
    imports: [],
    fileComplexity: {},
    filesByExt: {},
    byPlugin: {},
    generatedAt: "2026-04-29T00:00:00.000Z",
  };
}

describe("isTestFile — directory conventions", () => {
  it("matches /test/ anywhere in the path", () => {
    expect(isTestFile("test/foo.ts")).toBe(true);
    expect(isTestFile("src/test/foo.ts")).toBe(true);
    expect(isTestFile("packages/foo/test/bar.ts")).toBe(true);
  });

  it("matches /tests/ (plural) too", () => {
    expect(isTestFile("tests/integration/foo.py")).toBe(true);
    expect(isTestFile("packages/x/tests/y.rb")).toBe(true);
  });

  it("matches /__tests__/ (Jest / RTL convention)", () => {
    expect(isTestFile("src/foo/__tests__/bar.tsx")).toBe(true);
  });

  it("matches /spec/ and /specs/ (RSpec / Jasmine)", () => {
    expect(isTestFile("spec/models/user_spec.rb")).toBe(true);
    expect(isTestFile("specs/feature_test.py")).toBe(true);
  });

  it("does NOT match unrelated paths that contain test-like substrings", () => {
    // "tests" inside a longer filename (without slash boundaries) should
    // NOT trigger; only proper directory segments do.
    expect(isTestFile("src/protests/main.ts")).toBe(false);
    expect(isTestFile("src/contestant/foo.go")).toBe(false);
  });

  it("matches case-insensitively", () => {
    expect(isTestFile("Tests/Foo.cs")).toBe(true);
    expect(isTestFile("SRC/TEST/bar.java")).toBe(true);
  });
});

describe("isTestFile — filename suffixes", () => {
  it("matches Jest-style .test.* suffixes", () => {
    expect(isTestFile("src/foo.test.ts")).toBe(true);
    expect(isTestFile("src/foo.test.tsx")).toBe(true);
    expect(isTestFile("src/foo.test.js")).toBe(true);
    expect(isTestFile("src/foo.test.mjs")).toBe(true);
  });

  it("matches Mocha / Jasmine .spec.* suffixes", () => {
    expect(isTestFile("src/foo.spec.ts")).toBe(true);
    expect(isTestFile("src/foo.spec.js")).toBe(true);
  });

  it("matches Go _test.go convention", () => {
    expect(isTestFile("foo_test.go")).toBe(true);
    expect(isTestFile("pkg/bar_test.go")).toBe(true);
  });

  it("matches Python _test.py / _spec.py", () => {
    expect(isTestFile("module_test.py")).toBe(true);
    expect(isTestFile("module_spec.py")).toBe(true);
  });

  it("matches Ruby _spec.rb / _test.rb", () => {
    expect(isTestFile("user_spec.rb")).toBe(true);
    expect(isTestFile("user_test.rb")).toBe(true);
  });

  it("matches Java/Kotlin/C#/PHP Test/Tests suffix", () => {
    expect(isTestFile("UserServiceTest.java")).toBe(true);
    expect(isTestFile("UserServiceTests.java")).toBe(true);
    expect(isTestFile("UserServiceTest.kt")).toBe(true);
    expect(isTestFile("UserServiceTest.cs")).toBe(true);
    expect(isTestFile("UserServiceTests.cs")).toBe(true);
    expect(isTestFile("UserServiceTest.php")).toBe(true);
  });

  it("does NOT match production files with overlapping names", () => {
    expect(isTestFile("src/MyTest.ts")).toBe(false); // no .test.ts suffix
    expect(isTestFile("test.ts")).toBe(false); // no separator before "test"
  });
});

describe("isTestFile — filename prefixes", () => {
  it("matches Python test_ prefix", () => {
    expect(isTestFile("test_user.py")).toBe(true);
    expect(isTestFile("pkg/test_module.py")).toBe(true);
  });

  it("does not over-match prefix on unrelated files", () => {
    expect(isTestFile("testing_strategy.md")).toBe(false); // no test_ prefix exactly
    // "testharness.py" doesn't start with "test_" (no underscore)
    expect(isTestFile("testharness.py")).toBe(false);
  });
});

describe("isTestFile — edge cases", () => {
  it("returns false for empty string", () => {
    expect(isTestFile("")).toBe(false);
  });

  it("returns false for plain prod files", () => {
    expect(isTestFile("src/Logger.ts")).toBe(false);
    expect(isTestFile("lib/foo/bar.go")).toBe(false);
    expect(isTestFile("app.py")).toBe(false);
  });
});

describe("computeTestCoverage — basic aggregation", () => {
  it("returns zeros for an empty code graph", () => {
    const cov = computeTestCoverage(emptyCodeGraph());
    expect(cov.byFile.size).toBe(0);
    expect(cov.untestedHotspots).toEqual([]);
    expect(cov.totals).toEqual({
      prodFiles: 0,
      prodFilesWithCoverage: 0,
      prodFunctions: 0,
      testedProdFunctions: 0,
      testFiles: 0,
    });
  });

  it("classifies prod and test files correctly via isTestFile", () => {
    const cg = emptyCodeGraph();
    cg.functions = [
      { filePath: "src/Logger.ts", name: "log", startRow: 1, endRow: 5, complexity: 2 },
      { filePath: "src/Logger.ts", name: "warn", startRow: 7, endRow: 9, complexity: 1 },
      { filePath: "tests/Logger.test.ts", name: "testLog", startRow: 1, endRow: 10, complexity: 1 },
    ];
    const cov = computeTestCoverage(cg);
    expect(cov.totals.prodFiles).toBe(1);
    expect(cov.totals.testFiles).toBe(1);
    expect(cov.totals.prodFunctions).toBe(2);
    expect(cov.byFile.has("src/Logger.ts")).toBe(true);
    expect(cov.byFile.has("tests/Logger.test.ts")).toBe(false); // test file excluded
  });

  it("counts prod functions as tested when called from a test file", () => {
    const cg = emptyCodeGraph();
    cg.functions = [
      { filePath: "src/Logger.ts", name: "log", startRow: 1, endRow: 5, complexity: 2 },
      { filePath: "src/Logger.ts", name: "warn", startRow: 7, endRow: 9, complexity: 1 },
    ];
    cg.calls = [
      {
        fromFile: "tests/Logger.test.ts",
        fromFunction: "it_logs",
        calleeName: "log",
        toFile: "src/Logger.ts",
        toFunction: "log",
      },
      // warn is NOT called from anywhere — should remain untested
    ];
    const cov = computeTestCoverage(cg);
    const stats = cov.byFile.get("src/Logger.ts");
    expect(stats?.tested).toBe(1);
    expect(stats?.total).toBe(2);
    expect(cov.totals.testedProdFunctions).toBe(1);
  });

  it("does NOT count test-to-test calls as coverage", () => {
    const cg = emptyCodeGraph();
    cg.functions = [
      { filePath: "tests/foo.test.ts", name: "main", startRow: 1, endRow: 5, complexity: 1 },
      { filePath: "tests/helpers.ts", name: "fixture", startRow: 1, endRow: 3, complexity: 1 },
    ];
    cg.calls = [
      {
        fromFile: "tests/foo.test.ts",
        fromFunction: "main",
        calleeName: "fixture",
        toFile: "tests/helpers.ts",
        toFunction: "fixture",
      },
    ];
    const cov = computeTestCoverage(cg);
    // Both files are test files; neither shows up in byFile
    expect(cov.byFile.size).toBe(0);
    expect(cov.totals.prodFunctions).toBe(0);
  });

  it("does NOT count prod-to-prod calls as test coverage", () => {
    const cg = emptyCodeGraph();
    cg.functions = [
      { filePath: "src/A.ts", name: "a", startRow: 1, endRow: 5, complexity: 1 },
      { filePath: "src/B.ts", name: "b", startRow: 1, endRow: 5, complexity: 1 },
    ];
    cg.calls = [
      {
        fromFile: "src/A.ts",
        fromFunction: "a",
        calleeName: "b",
        toFile: "src/B.ts",
        toFunction: "b",
      },
    ];
    const cov = computeTestCoverage(cg);
    // No test files involved → no coverage hits
    expect(cov.totals.testedProdFunctions).toBe(0);
    expect(cov.byFile.get("src/B.ts")?.tested).toBe(0);
  });

  it("counts a prod fn called by multiple tests as tested ONCE", () => {
    const cg = emptyCodeGraph();
    cg.functions = [
      { filePath: "src/Logger.ts", name: "log", startRow: 1, endRow: 5, complexity: 2 },
    ];
    cg.calls = [
      {
        fromFile: "tests/a.test.ts",
        fromFunction: "t1",
        calleeName: "log",
        toFile: "src/Logger.ts",
        toFunction: "log",
      },
      {
        fromFile: "tests/b.test.ts",
        fromFunction: "t2",
        calleeName: "log",
        toFile: "src/Logger.ts",
        toFunction: "log",
      },
    ];
    const cov = computeTestCoverage(cg);
    const stats = cov.byFile.get("src/Logger.ts");
    expect(stats?.tested).toBe(1);
    // But the testers count reflects "distinct test files calling in"
    expect(stats?.testers).toBe(2);
  });

  it("respects toContainerType when matching coverage (v0.28 disambiguation)", () => {
    // Two same-named methods, one in Blueprint and one in
    // BlueprintSetupState. Test calls only Blueprint's. Only that one
    // should count as tested.
    const cg = emptyCodeGraph();
    cg.functions = [
      {
        filePath: "src/blueprints.py",
        name: "__init__",
        startRow: 1,
        endRow: 5,
        complexity: 4,
        containerType: "Blueprint",
      },
      {
        filePath: "src/blueprints.py",
        name: "__init__",
        startRow: 50,
        endRow: 55,
        complexity: 3,
        containerType: "BlueprintSetupState",
      },
    ];
    cg.calls = [
      {
        fromFile: "tests/test_blueprints.py",
        fromFunction: "test_init",
        calleeName: "__init__",
        toFile: "src/blueprints.py",
        toFunction: "__init__",
        toContainerType: "Blueprint",
      },
    ];
    const cov = computeTestCoverage(cg);
    const stats = cov.byFile.get("src/blueprints.py");
    expect(stats?.tested).toBe(1); // only Blueprint.__init__ tested
    expect(stats?.total).toBe(2);
    // The other __init__ should be in untested hotspots
    const untestedNames = cov.untestedHotspots.map(
      (h) => `${h.containerType}.${h.name}`
    );
    expect(untestedNames).toContain("BlueprintSetupState.__init__");
    expect(untestedNames).not.toContain("Blueprint.__init__");
  });
});

describe("computeTestCoverage — untested hotspots", () => {
  it("sorts untested functions by complexity descending", () => {
    const cg = emptyCodeGraph();
    cg.functions = [
      { filePath: "src/A.ts", name: "small", startRow: 1, endRow: 3, complexity: 2 },
      { filePath: "src/B.ts", name: "huge", startRow: 1, endRow: 50, complexity: 30 },
      { filePath: "src/C.ts", name: "medium", startRow: 1, endRow: 10, complexity: 8 },
    ];
    const cov = computeTestCoverage(cg);
    expect(cov.untestedHotspots.map((h) => h.name)).toEqual([
      "huge",
      "medium",
      "small",
    ]);
  });

  it("excludes tested functions from the hotspots list", () => {
    const cg = emptyCodeGraph();
    cg.functions = [
      { filePath: "src/A.ts", name: "covered", startRow: 1, endRow: 3, complexity: 30 },
      { filePath: "src/B.ts", name: "uncovered", startRow: 1, endRow: 5, complexity: 5 },
    ];
    cg.calls = [
      {
        fromFile: "tests/a.test.ts",
        fromFunction: "t",
        calleeName: "covered",
        toFile: "src/A.ts",
        toFunction: "covered",
      },
    ];
    const cov = computeTestCoverage(cg);
    expect(cov.untestedHotspots.map((h) => h.name)).toEqual(["uncovered"]);
  });

  it("caps the hotspots list at the configured limit", () => {
    const cg = emptyCodeGraph();
    cg.functions = Array.from({ length: 25 }, (_, i) => ({
      filePath: `src/F${i}.ts`,
      name: `fn${i}`,
      startRow: 1,
      endRow: 5,
      complexity: 100 - i,
    }));
    const cov = computeTestCoverage(cg, { untestedHotspotsLimit: 5 });
    expect(cov.untestedHotspots).toHaveLength(5);
    // Top 5 by complexity, descending — fn0 is complexity 100, fn4 is 96
    expect(cov.untestedHotspots.map((h) => h.name)).toEqual([
      "fn0",
      "fn1",
      "fn2",
      "fn3",
      "fn4",
    ]);
  });

  it("uses default limit of 10 when not specified", () => {
    const cg = emptyCodeGraph();
    cg.functions = Array.from({ length: 15 }, (_, i) => ({
      filePath: `src/F${i}.ts`,
      name: `fn${i}`,
      startRow: 1,
      endRow: 5,
      complexity: 50 - i,
    }));
    const cov = computeTestCoverage(cg);
    expect(cov.untestedHotspots).toHaveLength(10);
  });
});

describe("computeTestCoverage — totals", () => {
  it("aggregates correctly across a mixed codebase", () => {
    const cg = emptyCodeGraph();
    cg.functions = [
      { filePath: "src/A.ts", name: "a1", startRow: 1, endRow: 3, complexity: 1 },
      { filePath: "src/A.ts", name: "a2", startRow: 5, endRow: 8, complexity: 2 },
      { filePath: "src/B.ts", name: "b1", startRow: 1, endRow: 3, complexity: 1 },
      { filePath: "tests/A.test.ts", name: "test_a1", startRow: 1, endRow: 5, complexity: 1 },
    ];
    cg.calls = [
      {
        fromFile: "tests/A.test.ts",
        fromFunction: "test_a1",
        calleeName: "a1",
        toFile: "src/A.ts",
        toFunction: "a1",
      },
    ];
    const cov = computeTestCoverage(cg);
    expect(cov.totals.prodFiles).toBe(2); // src/A.ts, src/B.ts
    expect(cov.totals.testFiles).toBe(1); // tests/A.test.ts
    expect(cov.totals.prodFunctions).toBe(3); // a1, a2, b1
    expect(cov.totals.testedProdFunctions).toBe(1); // a1 only
    expect(cov.totals.prodFilesWithCoverage).toBe(1); // src/A.ts has coverage
  });
});
