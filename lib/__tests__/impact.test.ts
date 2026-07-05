// Coverage for the impact-analysis data layer (lib/impact.ts). The functions
// read only cg.imports + cg.calls, so the fixtures cast a minimal shape.

import { describe, it, expect } from "vitest";
import {
  isTestPath,
  deriveTestedFiles,
  rankFilesByFanIn,
  rankFunctionsInFile,
  toFileHighlight,
  impactFileList,
} from "../impact";
import type { CodeGraph } from "../codeAnalysis/types";

function graph(
  imports: { from: string; to: string }[],
  calls: {
    fromFile: string;
    toFile: string | null;
    fromFunction?: string | null;
    toFunction?: string | null;
    toContainerType?: string;
  }[] = [],
  functions: { filePath: string; name: string; containerType?: string }[] = []
): CodeGraph {
  return { imports, calls, functions } as unknown as CodeGraph;
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

describe("rankFunctionsInFile", () => {
  const fns = [
    { filePath: "src/core.ts", name: "init" },
    { filePath: "src/core.ts", name: "parse", containerType: "Parser" },
    { filePath: "src/core.ts", name: "helper" },
    { filePath: "src/other.ts", name: "elsewhere" },
  ];
  const calls = [
    // parse: two distinct callers
    { fromFile: "src/a.ts", fromFunction: "fa", toFile: "src/core.ts", toFunction: "parse", toContainerType: "Parser" },
    { fromFile: "src/b.ts", fromFunction: "fb", toFile: "src/core.ts", toFunction: "parse", toContainerType: "Parser" },
    // init: one caller, counted once despite duplicate edges
    { fromFile: "src/a.ts", fromFunction: "fa", toFile: "src/core.ts", toFunction: "init" },
    { fromFile: "src/a.ts", fromFunction: "fa", toFile: "src/core.ts", toFunction: "init" },
    // module-scope call — no source-side fn id, must not count
    { fromFile: "src/c.ts", fromFunction: null, toFile: "src/core.ts", toFunction: "helper" },
  ];

  it("ranks by distinct callers with uncalled functions included last", () => {
    const ranked = rankFunctionsInFile(graph([], calls, fns), "src/core.ts");
    expect(ranked.map((r) => [r.name, r.callers])).toEqual([
      ["parse", 2],
      ["init", 1],
      ["helper", 0],
    ]);
    expect(ranked[0].containerType).toBe("Parser");
  });

  it("only lists functions defined in the target file, respecting topN", () => {
    const ranked = rankFunctionsInFile(graph([], calls, fns), "src/core.ts", 2);
    expect(ranked).toHaveLength(2);
    expect(ranked.some((r) => r.name === "elsewhere")).toBe(false);
  });
});

describe("toFileHighlight", () => {
  it("collapses entries to per-file min hop and drops the target itself", () => {
    const h = toFileHighlight("src/core.ts", [
      { filePath: "src/a.ts", hop: 2 },
      { filePath: "src/a.ts", hop: 1 }, // min wins
      { filePath: "src/core.ts", hop: 1 }, // same-file entry dropped
      { filePath: "src/b.ts", hop: 3 },
    ]);
    expect(h.target).toBe("src/core.ts");
    expect(h.impacted.get("src/a.ts")).toBe(1);
    expect(h.impacted.get("src/b.ts")).toBe(3);
    expect(h.impacted.has("src/core.ts")).toBe(false);
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
