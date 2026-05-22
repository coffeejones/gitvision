// Golden fixture: a small, hand-counted Python project where every
// expected value (function count, names, complexity, resolved calls)
// has been verified by hand. If the extractor disagrees on any value,
// the test fails with the exact discrepancy.
//
// Fundamentally different from invariant tests:
//   Invariants  → "is the output structurally consistent?"  (cheap to add)
//   Golden      → "is the output correct?"                  (finds real bugs)
//
// HOW TO READ A FAILURE: When this test fails, EITHER the extractor
// has a bug, OR my hand-count is wrong. Verify by:
//   1. Manually counting the source again
//   2. Comparing against another tool (e.g. radon for complexity)
//   3. If hand-count is correct → extractor bug → fix it
//   4. If hand-count is wrong → update EXPECTED below + add a comment
//      explaining why (e.g. "Python's 'and' counts as decision point")
//
// To extend: add more files to FIXTURE + update EXPECTED.

import { describe, it, expect, beforeAll } from "vitest";
import { pythonPlugin } from "../codeAnalysis/plugins/python";
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

// ------------------- The fixture -------------------

const HELPER_PY = `def add(a, b):
    return a + b

def safe_div(a, b):
    if b == 0:
        return None
    return a / b
`;

const MAIN_PY = `from .helper import add, safe_div

def process(items):
    total = 0
    for item in items:
        if item > 0:
            total = add(total, item)
        elif item < 0:
            total = safe_div(total, -item)
    return total
`;

// ------------------- Hand-counted expectations -------------------
//
// helper.py:
//   add(a, b)      → no branches              → complexity 1
//   safe_div(a, b) → 1 if                     → complexity 2
//
// main.py:
//   process(items) → 1 for + 1 if + 1 elif    → complexity 4
//                    (base 1 + 3 decision points)
//
// Imports: main.py → helper.py (1 resolved import edge)
// Calls in process: add(), safe_div() — both resolve to helper.py
//
// NOTE: If repobaron's complexity rules differ (e.g. counts boolean
// operators or comprehensions), update EXPECTED and add a comment.

const EXPECTED = {
  functionCount: 3,
  functionNamesByFile: {
    "pkg/helper.py": ["add", "safe_div"],
    "pkg/main.py": ["process"],
  },
  complexities: {
    "pkg/helper.py::add": 1,
    "pkg/helper.py::safe_div": 2,
    "pkg/main.py::process": 4,
  },
  resolvedImports: 1, // main.py → helper.py
  callsFromProcess: 2, // add, safe_div
  resolvedCalleesFromProcess: ["add", "safe_div"], // both names, both should resolve
};

// ------------------- The tests -------------------

describe("golden Python fixture (hand-counted)", () => {
  beforeAll(async () => {
    await pythonPlugin.load();
  });

  function buildGraph() {
    const helper: SourceFile = { rel: "pkg/helper.py", ext: "py", content: HELPER_PY };
    const main: SourceFile = { rel: "pkg/main.py", ext: "py", content: MAIN_PY };
    const ix = makeIndex([helper, main]);
    const parsedHelper = parseFile(pythonPlugin, helper, ix);
    const parsedMain = parseFile(pythonPlugin, main, ix);
    return buildCodeGraph({
      parsedFiles: [parsedHelper, parsedMain],
      pluginByFile: new Map([
        ["pkg/helper.py", "python"],
        ["pkg/main.py", "python"],
      ]),
    });
  }

  it("extracts exactly 3 functions across both files", () => {
    const g = buildGraph();
    expect(g.functions).toHaveLength(EXPECTED.functionCount);
  });

  it("extracts the right function names in each file", () => {
    const g = buildGraph();
    for (const [filePath, expectedNames] of Object.entries(EXPECTED.functionNamesByFile)) {
      const actual = g.functions
        .filter((f) => f.filePath === filePath)
        .map((f) => f.name)
        .sort();
      expect(actual, `wrong function names in ${filePath}`).toEqual([...expectedNames].sort());
    }
  });

  it("computes the hand-counted cyclomatic complexity for every function", () => {
    const g = buildGraph();
    for (const [key, expectedComplexity] of Object.entries(EXPECTED.complexities)) {
      const [filePath, name] = key.split("::");
      const fn = g.functions.find((f) => f.filePath === filePath && f.name === name);
      expect(fn, `function ${key} not found`).toBeDefined();
      expect(
        fn!.complexity,
        `${key}: extractor says ${fn!.complexity}, hand-counted ${expectedComplexity}`
      ).toBe(expectedComplexity);
    }
  });

  it("resolves the relative import from main.py to helper.py", () => {
    const g = buildGraph();
    const resolvedImports = g.imports.filter((imp) => imp.from === "pkg/main.py");
    expect(resolvedImports.length).toBe(EXPECTED.resolvedImports);
    expect(resolvedImports[0]?.to).toBe("pkg/helper.py");
  });

  it("resolves both calls inside process() to functions in helper.py", () => {
    const g = buildGraph();
    const callsFromProcess = g.calls.filter(
      (c) => c.fromFile === "pkg/main.py" && c.fromFunction === "process"
    );

    expect(callsFromProcess.length).toBe(EXPECTED.callsFromProcess);

    const callees = callsFromProcess.map((c) => c.calleeName).sort();
    expect(callees).toEqual([...EXPECTED.resolvedCalleesFromProcess].sort());

    for (const call of callsFromProcess) {
      expect(
        call.toFile,
        `call to ${call.calleeName} from process should resolve to helper.py, got ${call.toFile}`
      ).toBe("pkg/helper.py");
      expect(call.toFunction).toBe(call.calleeName);
    }
  });
});
