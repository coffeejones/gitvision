// Edge-case golden fixture: targets specific Python language features
// where parsers commonly disagree or fail entirely.
//
// Unlike the basic golden fixture (which tests common-path correctness),
// this one is DESIGNED to probe the dark corners. A failure here is
// useful information, not a regression — it tells you exactly which
// language feature your plugin handles wrong.
//
// Coverage focus:
//   - @staticmethod  → does it become a function with the right container?
//   - async def      → is it extracted at all? same complexity rules?
//   - class methods  → do self.x() calls resolve to the same class?
//   - cross-class    → can `Service.normalize()` resolve from outside?
//
// Each test has a clear hand-counted answer. If a test fails:
//   1. Check if my hand-count is wrong (update EXPECTED + comment why)
//   2. If hand-count is right → real bug → file an issue, fix it
//
// To add more edge cases: add to FIXTURE, hand-count, add to EXPECTED.

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
//
// service.py defines a class with a static method + an async method.
// main.py calls Service.normalize() from module scope.

const SERVICE_PY = `class Service:
    @staticmethod
    def normalize(s):
        return s.strip()

    async def call(self, url):
        if url:
            return await self.fetch(url)
        return None
`;

const MAIN_PY = `from .service import Service

def run():
    return Service.normalize("  hi  ")
`;

// ------------------- Hand-counted expectations -------------------
//
// service.py:
//   Service.normalize  → @staticmethod, no decisions      → complexity 1
//                        containerType="Service", name="normalize"
//   Service.call       → async def, 1 if                  → complexity 2
//                        containerType="Service", name="call"
//
// main.py:
//   run                → no decisions                     → complexity 1
//                        no container, calls Service.normalize
//
// Total: 3 functions
// Imports: 1 (main.py → service.py)
// Calls: 1 (run → normalize, should resolve to service.py)
//
// NOTE: If Python plugin doesn't extract @staticmethod-decorated
// functions OR doesn't extract async def, the function count will be
// wrong and this test fails — exactly the diagnostic we want.

const EXPECTED = {
  functionCount: 3,
  hasStaticMethod: true, // normalize must be in functions[]
  hasAsyncMethod: true, // call must be in functions[]
  staticMethodContainer: "Service", // normalize.containerType
  asyncMethodContainer: "Service", // call.containerType
  staticMethodComplexity: 1,
  asyncMethodComplexity: 2,
  callsFromRunResolveTo: "service.py",
};

// ------------------- The tests -------------------

describe("golden Python fixture · edge cases", () => {
  beforeAll(async () => {
    await pythonPlugin.load();
  });

  function buildGraph() {
    const service: SourceFile = { rel: "pkg/service.py", ext: "py", content: SERVICE_PY };
    const main: SourceFile = { rel: "pkg/main.py", ext: "py", content: MAIN_PY };
    const ix = makeIndex([service, main]);
    const parsedService = parseFile(pythonPlugin, service, ix);
    const parsedMain = parseFile(pythonPlugin, main, ix);
    return buildCodeGraph({
      parsedFiles: [parsedService, parsedMain],
      pluginByFile: new Map([
        ["pkg/service.py", "python"],
        ["pkg/main.py", "python"],
      ]),
    });
  }

  it("extracts all 3 functions including @staticmethod and async def", () => {
    const g = buildGraph();
    const names = g.functions.map((f) => f.name).sort();
    expect(
      g.functions.length,
      `extracted only ${g.functions.length}/${EXPECTED.functionCount}: [${names.join(", ")}]`
    ).toBe(EXPECTED.functionCount);
  });

  it("@staticmethod-decorated function shows correct container + complexity", () => {
    const g = buildGraph();
    const normalize = g.functions.find((f) => f.name === "normalize");
    expect(normalize, "normalize() not extracted — plugin may skip @staticmethod").toBeDefined();
    expect(normalize!.containerType).toBe(EXPECTED.staticMethodContainer);
    expect(normalize!.complexity).toBe(EXPECTED.staticMethodComplexity);
  });

  it("async def function shows correct container + complexity", () => {
    const g = buildGraph();
    const call = g.functions.find((f) => f.name === "call");
    expect(call, "async call() not extracted — plugin may skip async def").toBeDefined();
    expect(call!.containerType).toBe(EXPECTED.asyncMethodContainer);
    expect(
      call!.complexity,
      `async call() complexity ${call?.complexity}, hand-counted ${EXPECTED.asyncMethodComplexity}`
    ).toBe(EXPECTED.asyncMethodComplexity);
  });

  it("call from a class method carries the caller's exact fromContainerType", () => {
    // self.fetch(url) inside Service.call — the edge is unresolved (fetch has no
    // def) but fromContainerType is stamped at parse time regardless.
    const g = buildGraph();
    const edge = g.calls.find((c) => c.fromFunction === "call" && c.calleeName === "fetch");
    expect(edge?.fromContainerType).toBe("Service");
  });

  it("Service.normalize() call from run() resolves cross-file", () => {
    const g = buildGraph();
    const callsFromRun = g.calls.filter(
      (c) => c.fromFile === "pkg/main.py" && c.fromFunction === "run"
    );
    expect(callsFromRun.length).toBeGreaterThan(0);

    const normalizeCall = callsFromRun.find((c) => c.calleeName === "normalize");
    expect(
      normalizeCall,
      `Service.normalize() call not captured — plugin may not handle ClassName.method() syntax`
    ).toBeDefined();
    expect(
      normalizeCall!.toFile,
      `Service.normalize() didn't resolve cross-file (got ${normalizeCall!.toFile})`
    ).toBe("pkg/service.py");
  });
});
