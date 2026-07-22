// Golden JavaScript fixture — hand-counted, exact-match.
// Targets: ES module imports, class methods, arrow functions,
// cross-file call resolution.

import { describe, it, expect, beforeAll } from "vitest";
import { javascriptPlugin } from "../codeAnalysis/plugins/javascript";
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

const HELPER_JS = `export function add(a, b) {
  return a + b;
}

export const safeDiv = (a, b) => {
  if (b === 0) return null;
  return a / b;
};
`;

const MAIN_JS = `import { add, safeDiv } from './helper.js';

export class Calculator {
  process(items) {
    let total = 0;
    for (const item of items) {
      if (item > 0) {
        total = add(total, item);
      } else if (item < 0) {
        total = safeDiv(total, -item);
      }
    }
    return total;
  }
}
`;

// HAND-COUNTED EXPECTATIONS:
// helper.js:
//   add        → no decisions          → complexity 1
//   safeDiv    → 1 if (arrow fn)       → complexity 2
// main.js:
//   process    → for + if + else-if    → complexity 4
// Cross-file: process calls add AND safeDiv, both should resolve to helper.js
// Imports: 1 import edge (main.js → helper.js)

describe("golden JavaScript fixture", () => {
  beforeAll(async () => {
    await javascriptPlugin.load();
  });

  function buildGraph() {
    const helper: SourceFile = { rel: "src/helper.js", ext: "js", content: HELPER_JS };
    const main: SourceFile = { rel: "src/main.js", ext: "js", content: MAIN_JS };
    const ix = makeIndex([helper, main]);
    const ph = parseFile(javascriptPlugin, helper, ix);
    const pm = parseFile(javascriptPlugin, main, ix);
    return buildCodeGraph({
      parsedFiles: [ph, pm],
      pluginByFile: new Map([
        ["src/helper.js", "javascript"],
        ["src/main.js", "javascript"],
      ]),
    });
  }

  it("extracts exactly 3 functions (add, safeDiv, process)", () => {
    const g = buildGraph();
    expect(g.functions.length).toBe(3);
  });

  it("function names match exactly", () => {
    const g = buildGraph();
    expect(g.functions.map((f) => f.name).sort()).toEqual(["add", "process", "safeDiv"]);
  });

  it("arrow function safeDiv is extracted", () => {
    const g = buildGraph();
    const fn = g.functions.find((f) => f.name === "safeDiv");
    expect(fn, "arrow-bound functions should be extracted").toBeDefined();
  });

  it("class method process has Calculator as containerType", () => {
    const g = buildGraph();
    const fn = g.functions.find((f) => f.name === "process");
    expect(fn?.containerType).toBe("Calculator");
  });

  it("complexity of add is 1 (no decisions)", () => {
    const g = buildGraph();
    expect(g.functions.find((f) => f.name === "add")?.complexity).toBe(1);
  });

  it("complexity of safeDiv is 2 (1 if)", () => {
    const g = buildGraph();
    expect(g.functions.find((f) => f.name === "safeDiv")?.complexity).toBe(2);
  });

  it("complexity of process is 4 (for + if + else-if)", () => {
    const g = buildGraph();
    expect(g.functions.find((f) => f.name === "process")?.complexity).toBe(4);
  });

  it("import from main.js to helper.js is resolved", () => {
    const g = buildGraph();
    const imp = g.imports.find((i) => i.from === "src/main.js");
    expect(imp?.to).toBe("src/helper.js");
  });

  it("call to add() inside process resolves to helper.js", () => {
    const g = buildGraph();
    const call = g.calls.find((c) => c.fromFunction === "process" && c.calleeName === "add");
    expect(call?.toFile).toBe("src/helper.js");
  });

  it("call to safeDiv() inside process resolves to helper.js", () => {
    const g = buildGraph();
    const call = g.calls.find(
      (c) => c.fromFunction === "process" && c.calleeName === "safeDiv"
    );
    expect(call?.toFile).toBe("src/helper.js");
  });

  it("call from a class method carries the caller's exact fromContainerType", () => {
    // End-to-end: the real plugin stamps the enclosing class onto the call
    // edge (process lives in Calculator), so the caller side of the function
    // blast radius is as exact as the callee side — no name-only guessing.
    const g = buildGraph();
    const call = g.calls.find((c) => c.fromFunction === "process" && c.calleeName === "add");
    expect(call?.fromContainerType).toBe("Calculator");
  });
});
