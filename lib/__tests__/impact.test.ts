// Coverage for the impact-analysis data layer (lib/impact.ts). The functions
// read only cg.imports + cg.calls, so the fixtures cast a minimal shape.

import { describe, it, expect } from "vitest";
import {
  isTestPath,
  deriveTestedFiles,
  rankFilesByFanIn,
  impactFileList,
} from "../impact";
import type { CodeGraph } from "../codeAnalysis/types";

function graph(
  imports: { from: string; to: string }[],
  calls: { fromFile: string; toFile: string | null }[] = []
): CodeGraph {
  return { imports, calls, functions: [] } as unknown as CodeGraph;
}

describe("isTestPath", () => {
  it("matches common test layouts across languages", () => {
    expect(isTestPath("src/app.test.ts")).toBe(true);
    expect(isTestPath("src/app.spec.tsx")).toBe(true);
    expect(isTestPath("tests/app.ts")).toBe(true);
    expect(isTestPath("packages/core/__tests__/x.ts")).toBe(true);
    expect(isTestPath("foo_test.go")).toBe(true);
    expect(isTestPath("spec/models/user_spec.rb")).toBe(true);
    expect(isTestPath("test_helpers.py")).toBe(true);
  });

  it("does not match real source files", () => {
    expect(isTestPath("src/app.ts")).toBe(false);
    expect(isTestPath("src/latest.ts")).toBe(false); // "test" substring, not a test
    expect(isTestPath("packages/core/src/container.ts")).toBe(false);
  });
});

describe("deriveTestedFiles", () => {
  it("marks files a test file imports or calls into as tested", () => {
    const cg = graph(
      [
        { from: "src/app.test.ts", to: "src/app.ts" }, // test imports app
        { from: "src/app.ts", to: "src/util.ts" }, // non-test import
      ],
      [
        { fromFile: "tests/util.spec.ts", toFile: "src/util.ts" }, // test calls util
        { fromFile: "src/app.ts", toFile: "src/db.ts" }, // non-test call
      ]
    );
    const tested = deriveTestedFiles(cg);
    expect(tested.has("src/app.ts")).toBe(true);
    expect(tested.has("src/util.ts")).toBe(true);
    expect(tested.has("src/db.ts")).toBe(false); // only reached from non-test
  });

  it("returns an empty set when no test files touch anything", () => {
    const cg = graph([{ from: "src/a.ts", to: "src/b.ts" }]);
    expect(deriveTestedFiles(cg).size).toBe(0);
  });
});

describe("rankFilesByFanIn", () => {
  it("ranks non-test files by distinct dependents, descending", () => {
    const cg = graph(
      [
        { from: "src/a.ts", to: "src/core.ts" },
        { from: "src/b.ts", to: "src/core.ts" },
        { from: "src/b.ts", to: "src/core.ts" }, // duplicate source — counts once
        { from: "src/a.ts", to: "src/util.ts" },
      ],
      [{ fromFile: "src/c.ts", toFile: "src/core.ts" }]
    );
    const ranked = rankFilesByFanIn(cg);
    expect(ranked[0]).toEqual({ file: "src/core.ts", dependents: 3 }); // a, b, c
    expect(ranked.find((r) => r.file === "src/util.ts")?.dependents).toBe(1);
  });

  it("excludes test files from the ranking", () => {
    const cg = graph([
      { from: "src/a.ts", to: "src/app.test.ts" }, // depending on a test file
      { from: "src/a.ts", to: "src/core.ts" },
    ]);
    const ranked = rankFilesByFanIn(cg);
    expect(ranked.some((r) => r.file === "src/app.test.ts")).toBe(false);
    expect(ranked.some((r) => r.file === "src/core.ts")).toBe(true);
  });

  it("respects topN", () => {
    const imports = Array.from({ length: 20 }, (_, i) => ({
      from: `src/dep${i}.ts`,
      to: `src/target${i % 5}.ts`,
    }));
    expect(rankFilesByFanIn(graph(imports), 3)).toHaveLength(3);
  });
});

describe("impactFileList", () => {
  it("returns distinct non-test files, sorted", () => {
    const cg = graph(
      [{ from: "src/b.ts", to: "src/a.ts" }],
      [{ fromFile: "tests/a.spec.ts", toFile: "src/a.ts" }]
    );
    expect(impactFileList(cg)).toEqual(["src/a.ts", "src/b.ts"]);
  });
});
