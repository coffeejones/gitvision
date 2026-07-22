// Golden Go fixture — package-level functions, struct methods,
// pointer receivers, cross-file (same package) call resolution.

import { describe, it, expect, beforeAll } from "vitest";
import { goPlugin } from "../codeAnalysis/plugins/go";
import { parseFile } from "../codeAnalysis/parse";
import { buildCodeGraph } from "../codeAnalysis/codeGraph";
import type { FileIndex, SourceFile } from "../codeAnalysis/types";

function makeIndex(files: SourceFile[]): FileIndex {
  const byPath = new Map<string, SourceFile>();
  const byExt = new Map<string, SourceFile[]>();
  for (const f of files) {
    byPath.set(f.rel, f);
    const arr = byExt.get(f.ext) ?? [];
    arr.push(f);
    byExt.set(f.ext, arr);
  }
  return { byPath, byExt, extras: new Map() };
}

const HELPER_GO = `package calc

func Add(a, b int) int {
\treturn a + b
}

func SafeDiv(a, b int) (int, bool) {
\tif b == 0 {
\t\treturn 0, false
\t}
\treturn a / b, true
}
`;

const MAIN_GO = `package calc

type Calculator struct {
\tname string
}

func (c *Calculator) Process(items []int) int {
\ttotal := 0
\tfor _, item := range items {
\t\tif item > 0 {
\t\t\ttotal = Add(total, item)
\t\t} else if item < 0 {
\t\t\tif v, ok := SafeDiv(total, -item); ok {
\t\t\t\ttotal = v
\t\t\t}
\t\t}
\t}
\treturn total
}
`;

// HAND-COUNTED:
// helper.go:
//   Add       → no decisions       → complexity 1
//   SafeDiv   → 1 if               → complexity 2
// main.go:
//   Calculator.Process →
//     for + if + else-if + nested if   → complexity 5
// Cross-file (same package): Process calls Add AND SafeDiv, both resolve to helper.go
//
// ⚠️  KNOWN BUG (uncovered by these tests, 2026-05-09):
//   The last 3 tests below FAIL because of a real bug in the Go plugin's
//   call extraction. When a method (e.g. `(c *Calculator) Process`) makes
//   a bare-name call (e.g. `Add(...)`), the plugin assumes Add is a method
//   on the receiver type Calculator, sets calleeType="Calculator", and
//   the strict type-aware match in pickCallTarget then fails to find Add
//   (which is a top-level function with no containerType).
//
//   File: lib/codeAnalysis/plugins/go.ts:701-705
//   Effect: cross-file calls from methods to package-level functions in
//           Go are reported as unresolved, undercounting blast radius and
//           untested-hotspot signals on every Go codebase.
//
//   These tests serve as regression coverage — once the bug is fixed, they
//   turn green and stay that way. Don't skip them.

describe("golden Go fixture", () => {
  beforeAll(async () => {
    await goPlugin.load();
  });

  function buildGraph() {
    const helper: SourceFile = { rel: "calc/helper.go", ext: "go", content: HELPER_GO };
    const main: SourceFile = { rel: "calc/main.go", ext: "go", content: MAIN_GO };
    const ix = makeIndex([helper, main]);
    const ph = parseFile(goPlugin, helper, ix);
    const pm = parseFile(goPlugin, main, ix);
    return buildCodeGraph({
      parsedFiles: [ph, pm],
      pluginByFile: new Map([
        ["calc/helper.go", "go"],
        ["calc/main.go", "go"],
      ]),
    });
  }

  it("extracts exactly 3 functions (Add, SafeDiv, Process)", () => {
    const g = buildGraph();
    expect(g.functions.length).toBe(3);
  });

  it("function names match exactly", () => {
    const g = buildGraph();
    expect(g.functions.map((f) => f.name).sort()).toEqual(["Add", "Process", "SafeDiv"]);
  });

  it("method Process has Calculator as containerType", () => {
    const g = buildGraph();
    const fn = g.functions.find((f) => f.name === "Process");
    expect(fn?.containerType).toBe("Calculator");
  });

  it("Add and SafeDiv are top-level (no containerType)", () => {
    const g = buildGraph();
    expect(g.functions.find((f) => f.name === "Add")?.containerType).toBeUndefined();
    expect(g.functions.find((f) => f.name === "SafeDiv")?.containerType).toBeUndefined();
  });

  it("complexity of Add is 1", () => {
    const g = buildGraph();
    expect(g.functions.find((f) => f.name === "Add")?.complexity).toBe(1);
  });

  it("complexity of SafeDiv is 2 (1 if)", () => {
    const g = buildGraph();
    expect(g.functions.find((f) => f.name === "SafeDiv")?.complexity).toBe(2);
  });

  it("complexity of Process is 5 (for + if + else-if + nested if)", () => {
    const g = buildGraph();
    expect(g.functions.find((f) => f.name === "Process")?.complexity).toBe(5);
  });

  it("Add() call inside Process resolves to helper.go", () => {
    const g = buildGraph();
    const call = g.calls.find((c) => c.fromFunction === "Process" && c.calleeName === "Add");
    expect(call?.toFile).toBe("calc/helper.go");
  });

  it("call from a method carries the caller's exact fromContainerType (receiver)", () => {
    const g = buildGraph();
    const call = g.calls.find((c) => c.fromFunction === "Process" && c.calleeName === "Add");
    expect(call?.fromContainerType).toBe("Calculator");
  });

  it("SafeDiv() call inside Process resolves to helper.go", () => {
    const g = buildGraph();
    const call = g.calls.find(
      (c) => c.fromFunction === "Process" && c.calleeName === "SafeDiv"
    );
    expect(call?.toFile).toBe("calc/helper.go");
  });

  it("graph has at least 2 resolved call edges from Process", () => {
    const g = buildGraph();
    const fromProcess = g.calls.filter(
      (c) => c.fromFunction === "Process" && c.toFile !== null
    );
    expect(fromProcess.length).toBeGreaterThanOrEqual(2);
  });
});
