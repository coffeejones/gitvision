// Tests for rankFunctionsByBlast() — the v0.58 ranking that powers the
// "Touch with care" panel. We hand-build minimal CodeGraphs and assert
// on the ranking shape to keep coverage tight on:
//   1. Direct in-degree filtering (the cheap pre-filter)
//   2. Transitive BFS counting (the expensive ranking step)
//   3. Test-file exclusion (test fns never appear; test→prod calls don't count)
//   4. Empty / degenerate graphs (no resolved calls, single function, etc.)
//   5. Tie-breaking (complexity, then name)
//   6. Cap behavior (truncated flag, candidatePoolSize)

import { describe, it, expect } from "vitest";
import { rankFunctionsByBlast } from "../codeAnalysis/blastRanking";
import type { CodeGraph, FunctionDef, CallEdge } from "../codeAnalysis/types";

// ------------------- Fixture builders -------------------

function emptyGraph(): CodeGraph {
  return {
    functions: [],
    calls: [],
    imports: [],
    fileComplexity: {},
    filesByExt: {},
    byPlugin: {},
  };
}

function fn(
  filePath: string,
  name: string,
  complexity = 1,
  containerType?: string
): FunctionDef {
  return {
    filePath,
    name,
    startRow: 1,
    endRow: 10,
    complexity,
    ...(containerType ? { containerType } : {}),
  };
}

function call(
  fromFile: string,
  fromFunction: string,
  toFile: string,
  toFunction: string,
  toContainerType?: string
): CallEdge {
  return {
    fromFile,
    fromFunction,
    calleeName: toFunction,
    toFile,
    toFunction,
    ...(toContainerType ? { toContainerType } : {}),
  };
}

// ------------------- Empty / degenerate -------------------

describe("rankFunctionsByBlast · degenerate cases", () => {
  it("returns [] on an empty graph", () => {
    expect(rankFunctionsByBlast(emptyGraph())).toEqual([]);
  });

  it("returns [] when there are functions but no resolved calls", () => {
    const cg = emptyGraph();
    cg.functions = [fn("a.ts", "foo"), fn("b.ts", "bar")];
    expect(rankFunctionsByBlast(cg)).toEqual([]);
  });

  it("returns [] when no function meets the minDirectIncoming floor", () => {
    const cg = emptyGraph();
    cg.functions = [fn("a.ts", "caller"), fn("b.ts", "callee")];
    // Only one direct caller — below default floor of 2
    cg.calls = [call("a.ts", "caller", "b.ts", "callee")];
    expect(rankFunctionsByBlast(cg)).toEqual([]);
  });

  it("returns [] when minDirectIncoming is loosened but no calls match", () => {
    const cg = emptyGraph();
    cg.functions = [fn("a.ts", "x")];
    expect(rankFunctionsByBlast(cg, { minDirectIncoming: 0 })).toEqual([]);
  });
});

// ------------------- Direct + transitive counting -------------------

describe("rankFunctionsByBlast · counting", () => {
  it("counts direct callers correctly", () => {
    const cg = emptyGraph();
    cg.functions = [
      fn("hub.ts", "core", 5),
      fn("a.ts", "callerA"),
      fn("b.ts", "callerB"),
      fn("c.ts", "callerC"),
    ];
    cg.calls = [
      call("a.ts", "callerA", "hub.ts", "core"),
      call("b.ts", "callerB", "hub.ts", "core"),
      call("c.ts", "callerC", "hub.ts", "core"),
    ];
    const ranked = rankFunctionsByBlast(cg);
    expect(ranked).toHaveLength(1);
    expect(ranked[0]).toMatchObject({
      name: "core",
      filePath: "hub.ts",
      directIncoming: 3,
      incomingCount: 3,
      complexity: 5,
    });
  });

  it("counts transitive callers via BFS", () => {
    // Chain: leaf <- mid <- top1, top2
    // For "leaf": direct = 1 (mid), transitive = 3 (mid + top1 + top2)
    const cg = emptyGraph();
    cg.functions = [
      fn("leaf.ts", "leaf", 8),
      fn("mid.ts", "mid"),
      fn("top1.ts", "top1"),
      fn("top2.ts", "top2"),
      // give mid 2 callers so it also passes the floor
      fn("extra.ts", "extra"),
    ];
    cg.calls = [
      call("mid.ts", "mid", "leaf.ts", "leaf"),
      call("top1.ts", "top1", "mid.ts", "mid"),
      call("top2.ts", "top2", "mid.ts", "mid"),
      call("extra.ts", "extra", "leaf.ts", "leaf"), // give leaf 2 direct
    ];
    const ranked = rankFunctionsByBlast(cg);
    const leaf = ranked.find((r) => r.name === "leaf");
    expect(leaf).toBeDefined();
    // Direct: mid + extra = 2; transitive: mid + extra + top1 + top2 = 4
    expect(leaf!.directIncoming).toBe(2);
    expect(leaf!.incomingCount).toBe(4);
  });

  it("does not double-count diamond paths in BFS", () => {
    // Diamond: target <- A <- root, target <- B <- root
    // Transitive incoming for target: A, B, root = 3 (root only counted once)
    const cg = emptyGraph();
    cg.functions = [
      fn("target.ts", "target"),
      fn("a.ts", "A"),
      fn("b.ts", "B"),
      fn("root.ts", "root"),
    ];
    cg.calls = [
      call("a.ts", "A", "target.ts", "target"),
      call("b.ts", "B", "target.ts", "target"),
      call("root.ts", "root", "a.ts", "A"),
      call("root.ts", "root", "b.ts", "B"),
    ];
    const ranked = rankFunctionsByBlast(cg);
    const target = ranked.find((r) => r.name === "target");
    expect(target).toBeDefined();
    expect(target!.directIncoming).toBe(2);
    // Without dedup: 4 (A, B, root via A, root via B). With dedup: 3.
    expect(target!.incomingCount).toBe(3);
  });

  it("respects maxHops — beyond the depth, callers don't count", () => {
    // Chain of length 5: f0 <- f1 <- f2 <- f3 <- f4 (each calls the next)
    const cg = emptyGraph();
    cg.functions = Array.from({ length: 5 }, (_, i) =>
      fn(`f${i}.ts`, `f${i}`)
    );
    cg.functions.push(fn("extra.ts", "extra")); // give f0 a 2nd direct caller
    cg.calls = [
      call("f1.ts", "f1", "f0.ts", "f0"),
      call("f2.ts", "f2", "f1.ts", "f1"),
      call("f3.ts", "f3", "f2.ts", "f2"),
      call("f4.ts", "f4", "f3.ts", "f3"),
      call("extra.ts", "extra", "f0.ts", "f0"),
    ];
    const ranked = rankFunctionsByBlast(cg, { maxHops: 2 });
    const f0 = ranked.find((r) => r.name === "f0");
    expect(f0).toBeDefined();
    // With maxHops=2: f1 (hop 1), f2 (hop 2), extra (hop 1) = 3 visible
    expect(f0!.incomingCount).toBe(3);
  });

  it("flags truncated when BFS hits maxNodes", () => {
    // Many direct callers, low maxNodes
    const cg = emptyGraph();
    cg.functions = [fn("hub.ts", "core")];
    for (let i = 0; i < 20; i++) {
      cg.functions.push(fn(`c${i}.ts`, `caller${i}`));
      cg.calls.push(call(`c${i}.ts`, `caller${i}`, "hub.ts", "core"));
    }
    const ranked = rankFunctionsByBlast(cg, { maxNodes: 5 });
    expect(ranked).toHaveLength(1);
    expect(ranked[0].truncated).toBe(true);
    expect(ranked[0].incomingCount).toBe(5);
    // directIncoming is unaffected by maxNodes (it's a single-pass tally)
    expect(ranked[0].directIncoming).toBe(20);
  });
});

// ------------------- Test-file exclusion -------------------

describe("rankFunctionsByBlast · test-file exclusion", () => {
  it("excludes test files from candidates", () => {
    const cg = emptyGraph();
    cg.functions = [
      fn("__tests__/util.test.ts", "testHelper"),
      fn("a.ts", "callerA"),
      fn("b.ts", "callerB"),
    ];
    cg.calls = [
      call("a.ts", "callerA", "__tests__/util.test.ts", "testHelper"),
      call("b.ts", "callerB", "__tests__/util.test.ts", "testHelper"),
    ];
    const ranked = rankFunctionsByBlast(cg);
    expect(ranked).toEqual([]);
  });

  it("excludes test→prod calls from incoming counts", () => {
    const cg = emptyGraph();
    cg.functions = [
      fn("prod.ts", "core"),
      fn("a.ts", "callerA"),
      fn("__tests__/x.test.ts", "testCaller"),
    ];
    cg.calls = [
      call("a.ts", "callerA", "prod.ts", "core"),
      call("__tests__/x.test.ts", "testCaller", "prod.ts", "core"),
    ];
    // Only callerA counts; testCaller is filtered → 1 direct caller, below floor
    expect(rankFunctionsByBlast(cg)).toEqual([]);
  });
});

// ------------------- Tie-breaking -------------------

describe("rankFunctionsByBlast · tie-breaking", () => {
  it("breaks incomingCount ties by complexity desc", () => {
    const cg = emptyGraph();
    cg.functions = [
      fn("a.ts", "simple", 2),
      fn("b.ts", "complex", 15),
      fn("p.ts", "p1"),
      fn("q.ts", "q1"),
      fn("r.ts", "r1"),
      fn("s.ts", "s1"),
    ];
    cg.calls = [
      call("p.ts", "p1", "a.ts", "simple"),
      call("q.ts", "q1", "a.ts", "simple"),
      call("r.ts", "r1", "b.ts", "complex"),
      call("s.ts", "s1", "b.ts", "complex"),
    ];
    const ranked = rankFunctionsByBlast(cg);
    expect(ranked).toHaveLength(2);
    // Both have incomingCount=2; complex wins on complexity
    expect(ranked[0].name).toBe("complex");
    expect(ranked[1].name).toBe("simple");
  });

  it("breaks identical complexity ties by name asc", () => {
    const cg = emptyGraph();
    cg.functions = [
      fn("a.ts", "zebra", 5),
      fn("b.ts", "alpha", 5),
      fn("p.ts", "p1"),
      fn("q.ts", "q1"),
      fn("r.ts", "r1"),
      fn("s.ts", "s1"),
    ];
    cg.calls = [
      call("p.ts", "p1", "a.ts", "zebra"),
      call("q.ts", "q1", "a.ts", "zebra"),
      call("r.ts", "r1", "b.ts", "alpha"),
      call("s.ts", "s1", "b.ts", "alpha"),
    ];
    const ranked = rankFunctionsByBlast(cg);
    expect(ranked.map((r) => r.name)).toEqual(["alpha", "zebra"]);
  });
});

// ------------------- Container disambiguation -------------------

describe("rankFunctionsByBlast · container disambiguation", () => {
  it("treats same-named methods in different containers as distinct", () => {
    const cg = emptyGraph();
    cg.functions = [
      fn("user.ts", "save", 4, "User"),
      fn("order.ts", "save", 6, "Order"),
      fn("a.ts", "a"),
      fn("b.ts", "b"),
      fn("c.ts", "c"),
      fn("d.ts", "d"),
      fn("e.ts", "e"),
    ];
    cg.calls = [
      call("a.ts", "a", "user.ts", "save", "User"),
      call("b.ts", "b", "user.ts", "save", "User"),
      call("c.ts", "c", "order.ts", "save", "Order"),
      call("d.ts", "d", "order.ts", "save", "Order"),
      call("e.ts", "e", "order.ts", "save", "Order"),
    ];
    const ranked = rankFunctionsByBlast(cg);
    expect(ranked).toHaveLength(2);
    // Order.save has 3 callers, User.save has 2 — Order ranks first
    expect(ranked[0].containerType).toBe("Order");
    expect(ranked[0].directIncoming).toBe(3);
    expect(ranked[1].containerType).toBe("User");
    expect(ranked[1].directIncoming).toBe(2);
  });
});

// ------------------- limit + candidatePoolSize -------------------

describe("rankFunctionsByBlast · limits", () => {
  it("respects the limit option (default 5)", () => {
    const cg = emptyGraph();
    // 10 hub functions, each with 2 callers
    for (let i = 0; i < 10; i++) {
      cg.functions.push(fn(`hub${i}.ts`, `hub${i}`, i));
    }
    for (let i = 0; i < 10; i++) {
      cg.functions.push(fn(`x${i}.ts`, `x${i}`));
      cg.functions.push(fn(`y${i}.ts`, `y${i}`));
      cg.calls.push(call(`x${i}.ts`, `x${i}`, `hub${i}.ts`, `hub${i}`));
      cg.calls.push(call(`y${i}.ts`, `y${i}`, `hub${i}.ts`, `hub${i}`));
    }
    expect(rankFunctionsByBlast(cg)).toHaveLength(5);
    expect(rankFunctionsByBlast(cg, { limit: 3 })).toHaveLength(3);
    expect(rankFunctionsByBlast(cg, { limit: 100 })).toHaveLength(10);
  });

  it("respects candidatePoolSize — fns outside the pool are not BFS'd", () => {
    // 10 hubs; pool=3 means only the top 3 by direct incoming get ranked
    const cg = emptyGraph();
    for (let i = 0; i < 10; i++) {
      cg.functions.push(fn(`hub${i}.ts`, `hub${i}`));
      // hub0 gets the most callers, hub9 the least, but all >= 2
      const callerCount = 10 - i + 2;
      for (let j = 0; j < callerCount; j++) {
        const caller = `c${i}_${j}`;
        cg.functions.push(fn(`${caller}.ts`, caller));
        cg.calls.push(call(`${caller}.ts`, caller, `hub${i}.ts`, `hub${i}`));
      }
    }
    const ranked = rankFunctionsByBlast(cg, {
      limit: 100,
      candidatePoolSize: 3,
    });
    expect(ranked).toHaveLength(3);
    // The 3 fns with highest direct incoming should win
    expect(ranked.map((r) => r.name)).toEqual(["hub0", "hub1", "hub2"]);
  });
});
