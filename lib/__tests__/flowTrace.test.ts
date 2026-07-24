import { describe, it, expect } from "vitest";
import {
  buildFlowIndex,
  computeFlowTrace,
  findFlowEntryPoints,
  flowNodeId,
  looksLikeEntryPoint,
} from "../codeAnalysis/flowTrace";
import type { CodeGraph, CallEdge, FunctionDef } from "../codeAnalysis/types";

function fn(filePath: string, name: string, complexity = 1): FunctionDef {
  return { filePath, name, startRow: 0, endRow: 5, complexity };
}
function call(
  fromFile: string,
  fromFunction: string | null,
  toFile: string | null,
  toFunction: string | null
): CallEdge {
  return { fromFile, fromFunction, calleeName: toFunction ?? "?", toFile, toFunction };
}
function graph(functions: FunctionDef[], calls: CallEdge[]): CodeGraph {
  return { functions, calls, imports: [], fileComplexity: {}, filesByExt: {}, byPlugin: {} };
}

describe("buildFlowIndex", () => {
  it("keeps only resolved function→function edges and reports the honest resolution rate", () => {
    const cg = graph(
      [fn("a.ts", "a"), fn("b.ts", "b")],
      [
        call("a.ts", "a", "b.ts", "b"), // resolved → kept
        call("a.ts", "a", null, null), // unresolved → dropped
        call("a.ts", null, "b.ts", "b"), // module-scope caller → dropped
      ]
    );
    const idx = buildFlowIndex(cg);
    expect(idx.adjacency.get(flowNodeId("a.ts", "a"))?.size).toBe(1);
    expect(idx.resolution).toMatchObject({ resolvedEdges: 1, totalEdges: 3, pct: 33 });
  });

  it("drops self-recursion (it adds no story) but still counts it as resolved", () => {
    const cg = graph([fn("a.ts", "a")], [call("a.ts", "a", "a.ts", "a")]);
    const idx = buildFlowIndex(cg);
    expect(idx.adjacency.get(flowNodeId("a.ts", "a"))).toBeUndefined();
    expect(idx.resolution.resolvedEdges).toBe(1);
  });

  it("excludes test files by default — a prod flow through a .test file is a resolver false positive", () => {
    const cg = graph(
      [fn("lib/write.ts", "write"), fn("lib/x.test.ts", "writeFile")],
      [call("lib/write.ts", "write", "lib/x.test.ts", "writeFile")]
    );
    expect(buildFlowIndex(cg).adjacency.size).toBe(0);
    // ...but the raw graph is still available for tooling that wants it.
    expect(buildFlowIndex(cg, { excludeTests: false }).adjacency.size).toBe(1);
  });

  it("counts each distinct caller once in inDegree, not each call site", () => {
    const cg = graph(
      [fn("a.ts", "a"), fn("b.ts", "b")],
      [call("a.ts", "a", "b.ts", "b"), call("a.ts", "a", "b.ts", "b")]
    );
    expect(buildFlowIndex(cg).inDegree.get(flowNodeId("b.ts", "b"))).toBe(1);
  });
});

describe("looksLikeEntryPoint", () => {
  it("matches route-shaped paths and handler-shaped names, uniformly across languages", () => {
    expect(looksLikeEntryPoint("app/api/sessions/route.ts", "POST")).toBe(true);
    expect(looksLikeEntryPoint("src/controllers/UserController.java", "login")).toBe(true);
    expect(looksLikeEntryPoint("cmd/server/x.go", "main")).toBe(true);
    expect(looksLikeEntryPoint("lib/githubApp/events/pullRequest.ts", "handlePullRequestEvent")).toBe(true);
    expect(looksLikeEntryPoint("lib/util.ts", "clamp")).toBe(false);
  });
});

describe("findFlowEntryPoints", () => {
  it("ranks route-like above nothing-calls-it above plain orchestrators", () => {
    const cg = graph(
      [fn("app/api/x/route.ts", "POST"), fn("lib/orphan.ts", "orphan"), fn("lib/mid.ts", "mid"), fn("lib/leaf.ts", "leaf")],
      [
        // route-like, fan-out 1
        call("app/api/x/route.ts", "POST", "lib/leaf.ts", "leaf"),
        // orphan (nothing calls it), fan-out 1
        call("lib/orphan.ts", "orphan", "lib/leaf.ts", "leaf"),
        // mid is called by leaf, and calls 3 things → orchestrator
        call("lib/leaf.ts", "leaf", "lib/mid.ts", "mid"),
        call("lib/mid.ts", "mid", "lib/a.ts", "a"),
        call("lib/mid.ts", "mid", "lib/b.ts", "b"),
        call("lib/mid.ts", "mid", "lib/c.ts", "c"),
      ]
    );
    const eps = findFlowEntryPoints(cg);
    expect(eps.map((e) => e.name)).toEqual(["POST", "orphan", "mid"]);
    expect(eps.map((e) => e.kind)).toEqual(["route-like", "root", "orchestrator"]);
  });

  it("excludes low-fan-out functions that are neither route-like nor roots", () => {
    const cg = graph(
      [fn("lib/a.ts", "a"), fn("lib/b.ts", "b"), fn("lib/c.ts", "c")],
      [call("lib/a.ts", "a", "lib/b.ts", "b"), call("lib/b.ts", "b", "lib/c.ts", "c")]
    );
    // 'b' is called by a and only calls one thing → not offered.
    expect(findFlowEntryPoints(cg).map((e) => e.name)).toEqual(["a"]);
  });

  it("honours the limit", () => {
    const calls: CallEdge[] = [];
    for (let i = 0; i < 10; i++) calls.push(call(`app/api/r${i}/route.ts`, "GET", "lib/x.ts", "x"));
    expect(findFlowEntryPoints(graph([], calls), { limit: 3 })).toHaveLength(3);
  });
});

describe("computeFlowTrace", () => {
  const cg = graph(
    [fn("route.ts", "POST", 4), fn("a.ts", "alpha", 7), fn("b.ts", "beta"), fn("c.ts", "gamma")],
    [
      call("route.ts", "POST", "b.ts", "beta"),
      call("route.ts", "POST", "a.ts", "alpha"),
      call("a.ts", "alpha", "c.ts", "gamma"),
    ]
  );

  it("builds a shortest-path tree with depths, parents and complexity", () => {
    const t = computeFlowTrace(cg, { filePath: "route.ts", name: "POST" });
    expect(t).not.toBeNull();
    const byName = Object.fromEntries(t!.nodes.map((n) => [n.name, n]));
    expect(t!.nodes).toHaveLength(4);
    expect(byName.POST).toMatchObject({ depth: 0, parentId: null, complexity: 4 });
    expect(byName.alpha).toMatchObject({ depth: 1, complexity: 7 });
    expect(byName.gamma.depth).toBe(2);
    expect(byName.gamma.parentId).toBe(byName.alpha.id);
    expect(t!.maxDepth).toBe(2);
    expect(t!.truncated).toBe(false);
  });

  it("returns null when the target has no resolved outgoing calls", () => {
    expect(computeFlowTrace(cg, { filePath: "c.ts", name: "gamma" })).toBeNull();
  });

  it("orders children deterministically by NAME, never by graph order (reach, not sequence)", () => {
    // The graph lists beta before alpha; the tree must not preserve that.
    const t = computeFlowTrace(cg, { filePath: "route.ts", name: "POST" })!;
    const kids = t.nodes.filter((n) => n.parentId === t.rootId).map((n) => n.name);
    expect(kids).toEqual(["alpha", "beta"]);
  });

  it("keeps the shortest path and records the re-reach as an elided child", () => {
    const diamond = graph(
      [],
      [
        call("r.ts", "root", "a.ts", "a"),
        call("r.ts", "root", "b.ts", "b"),
        call("a.ts", "a", "d.ts", "d"),
        call("b.ts", "b", "d.ts", "d"), // d reachable two ways
      ]
    );
    const t = computeFlowTrace(diamond, { filePath: "r.ts", name: "root" })!;
    expect(t.nodes.filter((n) => n.name === "d")).toHaveLength(1);
    const total = t.nodes.reduce((n, x) => n + x.elidedChildren, 0);
    expect(total).toBe(1); // whichever of a/b lost the race records it
  });

  it("marks truncated and counts what was cut when the depth cap bites", () => {
    const chain = graph(
      [],
      [
        call("f0.ts", "f0", "f1.ts", "f1"),
        call("f1.ts", "f1", "f2.ts", "f2"),
        call("f2.ts", "f2", "f3.ts", "f3"),
      ]
    );
    const t = computeFlowTrace(chain, { filePath: "f0.ts", name: "f0" }, { maxDepth: 2 })!;
    expect(t.maxDepth).toBe(2);
    expect(t.nodes.map((n) => n.name)).not.toContain("f3");
    expect(t.truncated).toBe(true);
    expect(t.nodes.find((n) => n.name === "f2")!.elidedChildren).toBe(1);
  });

  it("caps children per node so one wide parent can't make the tree unreadable", () => {
    const wide = graph([], Array.from({ length: 12 }, (_, i) => call("r.ts", "root", `k${i}.ts`, `k${i}`)));
    const t = computeFlowTrace(wide, { filePath: "r.ts", name: "root" }, { maxChildrenPerNode: 3 })!;
    expect(t.nodes.filter((n) => n.parentId === t.rootId)).toHaveLength(3);
    expect(t.truncated).toBe(true);
    // The undrawn 9 are counted, not silently dropped...
    expect(t.nodes.find((n) => n.parentId === null)!.elidedChildren).toBe(9);
    // ...and the headline reach still tells the truth about all 12.
    expect(t.reachedTotal).toBe(12);
  });

  it("marks truncated when the node cap bites", () => {
    const wide = graph([], Array.from({ length: 10 }, (_, i) => call("r.ts", "root", `k${i}.ts`, `k${i}`)));
    const t = computeFlowTrace(wide, { filePath: "r.ts", name: "root" }, { maxNodes: 4 })!;
    expect(t.nodes).toHaveLength(4);
    expect(t.truncated).toBe(true);
  });
});
