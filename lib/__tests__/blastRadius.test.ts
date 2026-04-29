// Tests for the blast-radius computation. Pure data — uses minimal CodeGraph
// fixtures so we exercise BFS, hop sorting, cycle handling, and the caps.

import { describe, it, expect } from "vitest";
import {
  computeBlastRadius,
  computeFunctionBlastRadius,
} from "../codeAnalysis/blastRadius";
import type { CodeGraph } from "../codeAnalysis/types";

function emptyCodeGraph(): CodeGraph {
  return {
    functions: [],
    calls: [],
    imports: [],
    fileComplexity: {},
    filesByExt: {},
    byPlugin: {},
    generatedAt: "2026-04-25T00:00:00.000Z",
  };
}

describe("computeBlastRadius", () => {
  it("returns empty incoming / outgoing for an isolated file", () => {
    const cg = emptyCodeGraph();
    const b = computeBlastRadius(cg, "src/lonely.ts");
    expect(b.incoming).toEqual([]);
    expect(b.outgoing).toEqual([]);
    expect(b.target).toBe("src/lonely.ts");
  });

  it("captures direct incoming dependencies (1 hop)", () => {
    const cg = emptyCodeGraph();
    cg.imports = [
      { from: "a.ts", to: "target.ts", kind: "import" },
      { from: "b.ts", to: "target.ts", kind: "import" },
    ];
    const b = computeBlastRadius(cg, "target.ts");
    expect(b.incoming.map((e) => e.filePath).sort()).toEqual(["a.ts", "b.ts"]);
    expect(b.incoming.every((e) => e.hop === 1)).toBe(true);
    expect(b.byHop.incoming).toEqual({ 1: 2 });
  });

  it("traverses transitively across multiple hops", () => {
    const cg = emptyCodeGraph();
    cg.imports = [
      { from: "page.ts", to: "comp.ts", kind: "import" },
      { from: "comp.ts", to: "lib.ts", kind: "import" },
      { from: "lib.ts", to: "util.ts", kind: "import" },
    ];
    const b = computeBlastRadius(cg, "util.ts");
    // Incoming chain: lib.ts (hop 1) ← comp.ts (hop 2) ← page.ts (hop 3)
    expect(b.incoming).toEqual([
      { filePath: "lib.ts", hop: 1 },
      { filePath: "comp.ts", hop: 2 },
      { filePath: "page.ts", hop: 3 },
    ]);
    expect(b.byHop.incoming).toEqual({ 1: 1, 2: 1, 3: 1 });
  });

  it("captures outgoing dependencies (what target depends on)", () => {
    const cg = emptyCodeGraph();
    cg.imports = [
      { from: "target.ts", to: "dep1.ts", kind: "import" },
      { from: "target.ts", to: "dep2.ts", kind: "import" },
      { from: "dep1.ts", to: "deep.ts", kind: "import" },
    ];
    const b = computeBlastRadius(cg, "target.ts");
    expect(b.outgoing.map((e) => e.filePath).sort()).toEqual([
      "deep.ts",
      "dep1.ts",
      "dep2.ts",
    ]);
    const byHop = b.byHop.outgoing;
    expect(byHop[1]).toBe(2); // dep1, dep2
    expect(byHop[2]).toBe(1); // deep via dep1
  });

  it("respects maxHops cap", () => {
    const cg = emptyCodeGraph();
    cg.imports = [
      { from: "a.ts", to: "target.ts", kind: "import" },
      { from: "b.ts", to: "a.ts", kind: "import" },
      { from: "c.ts", to: "b.ts", kind: "import" },
      { from: "d.ts", to: "c.ts", kind: "import" },
    ];
    const b = computeBlastRadius(cg, "target.ts", { maxHops: 2 });
    // Only hop 1 (a.ts) and hop 2 (b.ts) — c.ts and d.ts cut off
    expect(b.incoming.map((e) => e.filePath)).toEqual(["a.ts", "b.ts"]);
  });

  it("uses call edges when toFile is resolved", () => {
    const cg = emptyCodeGraph();
    cg.calls = [
      {
        fromFile: "caller.ts",
        fromFunction: "main",
        calleeName: "doStuff",
        toFile: "target.ts",
        toFunction: "doStuff",
      },
      // Unresolved call (toFile null) doesn't contribute
      {
        fromFile: "ghost.ts",
        fromFunction: null,
        calleeName: "external",
        toFile: null,
        toFunction: null,
      },
    ];
    const b = computeBlastRadius(cg, "target.ts");
    expect(b.incoming.map((e) => e.filePath)).toEqual(["caller.ts"]);
  });

  it("merges import + call edges without double-counting", () => {
    const cg = emptyCodeGraph();
    cg.imports = [{ from: "a.ts", to: "target.ts", kind: "import" }];
    cg.calls = [
      {
        fromFile: "a.ts",
        fromFunction: "x",
        calleeName: "y",
        toFile: "target.ts",
        toFunction: "y",
      },
    ];
    const b = computeBlastRadius(cg, "target.ts");
    expect(b.incoming).toEqual([{ filePath: "a.ts", hop: 1 }]);
  });

  it("ignores self-edges defensively", () => {
    const cg = emptyCodeGraph();
    cg.imports = [{ from: "target.ts", to: "target.ts", kind: "import" }];
    const b = computeBlastRadius(cg, "target.ts");
    expect(b.incoming).toEqual([]);
    expect(b.outgoing).toEqual([]);
  });

  it("handles cycles without infinite looping", () => {
    const cg = emptyCodeGraph();
    cg.imports = [
      { from: "a.ts", to: "b.ts", kind: "import" },
      { from: "b.ts", to: "c.ts", kind: "import" },
      { from: "c.ts", to: "a.ts", kind: "import" }, // closes the cycle
    ];
    const b = computeBlastRadius(cg, "a.ts");
    // Outgoing from a.ts: b.ts (1), c.ts (2). Doesn't revisit a.ts.
    expect(b.outgoing.map((e) => `${e.filePath}@${e.hop}`)).toEqual([
      "b.ts@1",
      "c.ts@2",
    ]);
  });

  it("flags truncated when the per-direction node cap is hit, capping at exactly maxNodes entries", () => {
    const cg = emptyCodeGraph();
    // 50 fan-in files all pointing at target
    for (let i = 0; i < 50; i++) {
      cg.imports.push({
        from: `caller${i}.ts`,
        to: "target.ts",
        kind: "import",
      });
    }
    const b = computeBlastRadius(cg, "target.ts", { maxNodes: 10 });
    // The cap counts result entries (target is not an entry), so exactly
    // maxNodes entries are surfaced — no off-by-one in the truncation message.
    expect(b.incoming.length).toBe(10);
    expect(b.truncated).toMatch(/Capped at 10/);
  });

  it("sorts entries by hop ascending then file alphabetically", () => {
    const cg = emptyCodeGraph();
    cg.imports = [
      { from: "z.ts", to: "target.ts", kind: "import" }, // hop 1
      { from: "a.ts", to: "target.ts", kind: "import" }, // hop 1
      { from: "m.ts", to: "z.ts", kind: "import" }, // hop 2 via z
    ];
    const b = computeBlastRadius(cg, "target.ts");
    expect(b.incoming).toEqual([
      { filePath: "a.ts", hop: 1 },
      { filePath: "z.ts", hop: 1 },
      { filePath: "m.ts", hop: 2 },
    ]);
  });
});

describe("computeFunctionBlastRadius", () => {
  it("returns empty results for a function with no incoming/outgoing calls", () => {
    const cg = emptyCodeGraph();
    const b = computeFunctionBlastRadius(cg, "src/x.ts", "lonely");
    expect(b.incoming).toEqual([]);
    expect(b.outgoing).toEqual([]);
    expect(b.target).toEqual({ filePath: "src/x.ts", name: "lonely" });
  });

  it("captures direct callers (incoming hop 1)", () => {
    const cg = emptyCodeGraph();
    cg.calls = [
      {
        fromFile: "caller.ts",
        fromFunction: "main",
        calleeName: "doStuff",
        toFile: "target.ts",
        toFunction: "doStuff",
      },
    ];
    const b = computeFunctionBlastRadius(cg, "target.ts", "doStuff");
    expect(b.incoming).toEqual([
      { filePath: "caller.ts", name: "main", hop: 1 },
    ]);
    expect(b.outgoing).toEqual([]);
  });

  it("captures direct callees (outgoing hop 1)", () => {
    const cg = emptyCodeGraph();
    cg.calls = [
      {
        fromFile: "main.ts",
        fromFunction: "run",
        calleeName: "helper",
        toFile: "lib.ts",
        toFunction: "helper",
      },
    ];
    const b = computeFunctionBlastRadius(cg, "main.ts", "run");
    expect(b.outgoing).toEqual([
      { filePath: "lib.ts", name: "helper", hop: 1 },
    ]);
    expect(b.incoming).toEqual([]);
  });

  it("traverses transitively across multiple hops", () => {
    const cg = emptyCodeGraph();
    cg.calls = [
      // page.handle → controller.dispatch → service.lookup → repo.find
      {
        fromFile: "page.ts",
        fromFunction: "handle",
        calleeName: "dispatch",
        toFile: "controller.ts",
        toFunction: "dispatch",
      },
      {
        fromFile: "controller.ts",
        fromFunction: "dispatch",
        calleeName: "lookup",
        toFile: "service.ts",
        toFunction: "lookup",
      },
      {
        fromFile: "service.ts",
        fromFunction: "lookup",
        calleeName: "find",
        toFile: "repo.ts",
        toFunction: "find",
      },
    ];
    const b = computeFunctionBlastRadius(cg, "repo.ts", "find");
    expect(b.incoming).toEqual([
      { filePath: "service.ts", name: "lookup", hop: 1 },
      { filePath: "controller.ts", name: "dispatch", hop: 2 },
      { filePath: "page.ts", name: "handle", hop: 3 },
    ]);
    expect(b.byHop.incoming).toEqual({ 1: 1, 2: 1, 3: 1 });
  });

  it("ignores module-scope calls (fromFunction null) — no source-side fn id", () => {
    const cg = emptyCodeGraph();
    cg.calls = [
      {
        fromFile: "init.ts",
        fromFunction: null,
        calleeName: "setup",
        toFile: "target.ts",
        toFunction: "setup",
      },
    ];
    const b = computeFunctionBlastRadius(cg, "target.ts", "setup");
    expect(b.incoming).toEqual([]);
  });

  it("ignores unresolved calls (toFile or toFunction null)", () => {
    const cg = emptyCodeGraph();
    cg.calls = [
      {
        fromFile: "a.ts",
        fromFunction: "x",
        calleeName: "external",
        toFile: null,
        toFunction: null,
      },
    ];
    const b = computeFunctionBlastRadius(cg, "a.ts", "x");
    expect(b.outgoing).toEqual([]);
  });

  it("disambiguates same-named functions across files", () => {
    // Two different `parse` functions in different files. Blasting one
    // shouldn't surface callers of the other.
    const cg = emptyCodeGraph();
    cg.calls = [
      {
        fromFile: "json.ts",
        fromFunction: "main",
        calleeName: "parse",
        toFile: "json.ts",
        toFunction: "parse",
      },
      {
        fromFile: "yaml.ts",
        fromFunction: "main",
        calleeName: "parse",
        toFile: "yaml.ts",
        toFunction: "parse",
      },
    ];
    const b = computeFunctionBlastRadius(cg, "json.ts", "parse");
    expect(b.incoming).toEqual([
      { filePath: "json.ts", name: "main", hop: 1 },
    ]);
  });

  it("handles function-level cycles without infinite looping", () => {
    const cg = emptyCodeGraph();
    cg.calls = [
      // x → y → x: closed cycle. BFS from x sees y once.
      {
        fromFile: "a.ts",
        fromFunction: "x",
        calleeName: "y",
        toFile: "a.ts",
        toFunction: "y",
      },
      {
        fromFile: "a.ts",
        fromFunction: "y",
        calleeName: "x",
        toFile: "a.ts",
        toFunction: "x",
      },
    ];
    const b = computeFunctionBlastRadius(cg, "a.ts", "x");
    expect(b.outgoing).toEqual([
      { filePath: "a.ts", name: "y", hop: 1 },
    ]);
  });

  it("respects maxHops cap", () => {
    const cg = emptyCodeGraph();
    cg.calls = [
      {
        fromFile: "a.ts",
        fromFunction: "x",
        calleeName: "y",
        toFile: "a.ts",
        toFunction: "y",
      },
      {
        fromFile: "a.ts",
        fromFunction: "y",
        calleeName: "z",
        toFile: "a.ts",
        toFunction: "z",
      },
      {
        fromFile: "a.ts",
        fromFunction: "z",
        calleeName: "w",
        toFile: "a.ts",
        toFunction: "w",
      },
    ];
    const b = computeFunctionBlastRadius(cg, "a.ts", "x", { maxHops: 2 });
    expect(b.outgoing.map((e) => e.name)).toEqual(["y", "z"]);
  });

  it("flags truncated when nodes cap is hit, with a 'functions' unit message", () => {
    const cg = emptyCodeGraph();
    for (let i = 0; i < 30; i++) {
      cg.calls.push({
        fromFile: `caller${i}.ts`,
        fromFunction: "f",
        calleeName: "target",
        toFile: "t.ts",
        toFunction: "target",
      });
    }
    const b = computeFunctionBlastRadius(cg, "t.ts", "target", { maxNodes: 10 });
    expect(b.incoming.length).toBe(10);
    expect(b.truncated).toMatch(/Capped at 10 functions/);
  });

  // ------------------- v0.28: containerType disambiguation -------------------

  it("distinguishes same-named overloads in the same file via toContainerType", () => {
    // Flask blueprints scenario: Blueprint.__init__ and
    // BlueprintSetupState.__init__ both live in blueprints.py. Without
    // toContainerType (pre-v0.28), BFS keys on (file, name) and both
    // collapse to one node. With it, each is distinct.
    const cg = emptyCodeGraph();
    cg.functions = [
      {
        filePath: "blueprints.py",
        name: "__init__",
        startRow: 10,
        endRow: 15,
        complexity: 4,
        containerType: "Blueprint",
      },
      {
        filePath: "blueprints.py",
        name: "__init__",
        startRow: 100,
        endRow: 110,
        complexity: 3,
        containerType: "BlueprintSetupState",
      },
    ];
    cg.calls = [
      // factory() calls Blueprint.__init__
      {
        fromFile: "factory.py",
        fromFunction: "make_blueprint",
        calleeName: "__init__",
        toFile: "blueprints.py",
        toFunction: "__init__",
        toContainerType: "Blueprint",
      },
      // setup() calls BlueprintSetupState.__init__
      {
        fromFile: "app.py",
        fromFunction: "setup",
        calleeName: "__init__",
        toFile: "blueprints.py",
        toFunction: "__init__",
        toContainerType: "BlueprintSetupState",
      },
    ];

    // Blast on Blueprint.__init__ → only the factory caller
    const blueprint = computeFunctionBlastRadius(cg, "blueprints.py", "__init__", {
      targetContainerType: "Blueprint",
    });
    expect(blueprint.incoming).toEqual([
      {
        filePath: "factory.py",
        name: "make_blueprint",
        containerType: undefined,
        hop: 1,
      },
    ]);

    // Blast on BlueprintSetupState.__init__ → only the setup caller
    const state = computeFunctionBlastRadius(cg, "blueprints.py", "__init__", {
      targetContainerType: "BlueprintSetupState",
    });
    expect(state.incoming).toEqual([
      {
        filePath: "app.py",
        name: "setup",
        containerType: undefined,
        hop: 1,
      },
    ]);
  });

  it("collapses overloads when targetContainerType is undefined (legacy snapshots)", () => {
    // Pre-v0.28 callers and snapshots without toContainerType all encode
    // with empty container slot. Pre-v0.28 behavior is preserved when no
    // target container is supplied — same as before.
    const cg = emptyCodeGraph();
    cg.calls = [
      {
        fromFile: "a.py",
        fromFunction: "x",
        calleeName: "init",
        toFile: "b.py",
        toFunction: "init",
        // no toContainerType
      },
      {
        fromFile: "c.py",
        fromFunction: "y",
        calleeName: "init",
        toFile: "b.py",
        toFunction: "init",
      },
    ];
    const b = computeFunctionBlastRadius(cg, "b.py", "init");
    // Without container disambiguation, both callers reach the same node
    expect(b.incoming).toHaveLength(2);
  });

  it("populates source-side containerType from cg.functions when rendering callers", () => {
    // CallEdge doesn't carry fromContainerType — we infer it from
    // cg.functions for display so callers' chips show "Class.method".
    const cg = emptyCodeGraph();
    cg.functions = [
      {
        filePath: "callers.py",
        name: "main",
        startRow: 1,
        endRow: 10,
        complexity: 1,
        containerType: "App",
      },
    ];
    cg.calls = [
      {
        fromFile: "callers.py",
        fromFunction: "main",
        calleeName: "doStuff",
        toFile: "lib.py",
        toFunction: "doStuff",
        toContainerType: "Worker",
      },
    ];
    const b = computeFunctionBlastRadius(cg, "lib.py", "doStuff", {
      targetContainerType: "Worker",
    });
    expect(b.incoming).toEqual([
      {
        filePath: "callers.py",
        name: "main",
        containerType: "App",
        hop: 1,
      },
    ]);
  });

  it("preserves containerType on outgoing entries (callees) too", () => {
    const cg = emptyCodeGraph();
    cg.functions = [
      {
        filePath: "lib.py",
        name: "helper",
        startRow: 1,
        endRow: 5,
        complexity: 1,
        containerType: "Helper",
      },
    ];
    cg.calls = [
      {
        fromFile: "main.py",
        fromFunction: "run",
        calleeName: "helper",
        toFile: "lib.py",
        toFunction: "helper",
        toContainerType: "Helper",
      },
    ];
    const b = computeFunctionBlastRadius(cg, "main.py", "run");
    expect(b.outgoing).toEqual([
      {
        filePath: "lib.py",
        name: "helper",
        containerType: "Helper",
        hop: 1,
      },
    ]);
  });
});
