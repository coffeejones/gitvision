import { describe, it, expect } from "vitest";
import {
  buildFlowIndex,
  computeFlowTrace,
  findDeclaredEntryPoints,
  findFlowEntryPoints,
  flowNodeId,
  looksLikeEntryPoint,
} from "../codeAnalysis/flowTrace";
import type {
  CodeGraph,
  CallEdge,
  EntryPointInfo,
  FunctionDef,
} from "../codeAnalysis/types";

function fn(filePath: string, name: string, complexity = 1): FunctionDef {
  return { filePath, name, startRow: 0, endRow: 5, complexity };
}
/** A function a plugin declared an entry point — a decorated route handler. */
function routeFn(
  filePath: string,
  name: string,
  route: string,
  methods?: string[]
): FunctionDef {
  const entryPoint: EntryPointInfo = methods
    ? { kind: "http-route", methods, route, via: "@app.get" }
    : { kind: "http-route", route, via: "@app.route" };
  return { ...fn(filePath, name), entryPoint };
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

  it("scores own-code resolution, not library calls — the headline pct undersells by ~10x", () => {
    const cg = graph(
      [fn("lib/a.ts", "helper"), fn("lib/b.ts", "caller")],
      [
        call("lib/b.ts", "caller", "lib/a.ts", "helper"), // own call, resolved
        call("lib/b.ts", "caller", null, null), // console.log — nothing to point at
        call("lib/b.ts", "caller", null, null), // Array.map — likewise
        call("lib/b.ts", "caller", null, null), // expect() — likewise
      ]
    );
    const r = buildFlowIndex(cg).resolution;
    expect(r.pct).toBe(25); // 1 of 4 edges — reads like a failing grade
    expect(r.ownPct).toBe(100); // but every call at our own code resolved
    expect(r.ownTotal).toBe(1);
  });

  it("counts an unresolved call as a miss only when it names a function we define", () => {
    const cg = graph(
      [fn("lib/a.ts", "helper")],
      [
        call("lib/b.ts", "caller", null, null), // names "helper" → a real miss
        call("lib/b.ts", "caller", null, null),
      ]
    );
    cg.calls[0].calleeName = "helper";
    cg.calls[1].calleeName = "someLibraryThing";
    const r = buildFlowIndex(cg).resolution;
    expect(r.ownMissed).toBe(1);
    expect(r.ownPct).toBe(0);
  });

  it("counts resolved and missed on the SAME population — an asymmetric count inflates the score", () => {
    const cg = graph(
      [fn("lib/a.ts", "helper")],
      [
        call("lib/a.test.ts", "spec", "lib/a.ts", "helper"), // resolved, but from a test
        call("lib/b.ts", "caller", null, null), // missed, from prod
      ]
    );
    cg.calls[1].calleeName = "helper";
    const r = buildFlowIndex(cg).resolution;
    // The test-file hit must NOT pad the numerator while test misses are excluded.
    expect(r.ownResolved).toBe(0);
    expect(r.ownMissed).toBe(1);
    expect(r.ownPct).toBe(0);
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

// ---------------------------------------------------------------------------
// Declared entry points — evidence from a plugin, not inference from a name.
// ---------------------------------------------------------------------------
describe("declared entry points", () => {
  it("indexes a plugin's declaration verbatim", () => {
    const cg = graph([routeFn("views.py", "search", "/search", ["GET"])], []);
    const idx = buildFlowIndex(cg);
    expect(idx.declaredEntries.get(flowNodeId("views.py", "search"))).toEqual({
      kind: "http-route",
      methods: ["GET"],
      route: "/search",
      via: "@app.get",
    });
  });

  it("counts a declared handler as route-like even when its name and path look like nothing", () => {
    // The heuristic cannot see this: "search" in "views.py" matches neither the
    // route-like path list nor the name patterns. That miss is exactly why
    // Python measured 1 route-like entry across a whole Flask app.
    expect(looksLikeEntryPoint("views.py", "search")).toBe(false);

    const cg = graph(
      [routeFn("views.py", "search", "/search", ["GET"]), fn("db.py", "query")],
      [call("views.py", "search", "db.py", "query")]
    );
    const [entry] = findFlowEntryPoints(cg);
    expect(entry.kind).toBe("route-like");
    expect(entry.declared?.route).toBe("/search");
  });

  it("ranks a declared entry above one the heuristic merely guessed", () => {
    const cg = graph(
      [
        routeFn("views.py", "search", "/search", ["GET"]),
        fn("handlers/main.py", "main"),
        fn("db.py", "query"),
        fn("db.py", "other"),
      ],
      [
        call("views.py", "search", "db.py", "query"),
        call("handlers/main.py", "main", "db.py", "other"),
      ]
    );
    const eps = findFlowEntryPoints(cg);
    expect(eps[0].name).toBe("search");
    expect(eps[0].declared).toBeDefined();
    // The guessed one still qualifies — it just ranks below the evidence.
    expect(eps.find((e) => e.name === "main")?.declared).toBeUndefined();
  });

  it("returns declared handlers that call nothing, which the ranked list drops", () => {
    // A route handler with no own-repo callees is not a story worth drawing, so
    // findFlowEntryPoints skips it. Reachability still needs it: a sink written
    // inline in that handler is as reachable as code gets.
    const cg = graph([routeFn("views.py", "ping", "/ping", ["GET"])], []);
    expect(findFlowEntryPoints(cg)).toHaveLength(0);

    const declared = findDeclaredEntryPoints(cg);
    expect(declared).toHaveLength(1);
    expect(declared[0]).toMatchObject({ name: "ping", fanOut: 0, kind: "route-like" });
  });

  it("is empty for a graph no plugin declared anything in", () => {
    const cg = graph([fn("a.py", "a"), fn("b.py", "b")], [call("a.py", "a", "b.py", "b")]);
    expect(findDeclaredEntryPoints(cg)).toEqual([]);
    expect(buildFlowIndex(cg).declaredEntries.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// The resolution metric counts EVIDENCE, not name collisions.
// ---------------------------------------------------------------------------
describe("FlowResolution — own-code evidence", () => {
  it("does not count a method call on an untyped receiver as our own miss", () => {
    // `request.POST.get()` in a repo that happens to define a `get` somewhere.
    // Scoring this as "we failed to resolve our own code" put pygoat at 25%
    // when the resolver was correctly refusing 74 dict and ORM calls.
    const cg = graph(
      [fn("challenge/views.py", "get")],
      [
        {
          fromFile: "app/views.py",
          fromFunction: "search",
          calleeName: "get",
          toFile: null,
          toFunction: null,
          hasReceiver: true,
        },
      ]
    );
    const r = buildFlowIndex(cg).resolution;
    expect(r.ownMissed).toBe(0);
    expect(r.ownTotal).toBe(0);
  });

  it("still counts a bare call naming one of our functions", () => {
    const cg = graph(
      [fn("app/util.py", "helper")],
      [call("app/views.py", "search", null, null)]
    );
    const withName = {
      ...cg,
      calls: [{ ...cg.calls[0], calleeName: "helper" }],
    };
    expect(buildFlowIndex(withName).resolution.ownMissed).toBe(1);
  });

  it("counts a receiver typed as a class we define — that one should have resolved", () => {
    const cg = graph(
      [{ ...fn("app/repo.py", "save"), containerType: "Repo" }],
      [
        {
          fromFile: "app/views.py",
          fromFunction: "create",
          calleeName: "save",
          toFile: null,
          toFunction: null,
          hasReceiver: true,
          calleeType: "Repo",
        },
      ]
    );
    expect(buildFlowIndex(cg).resolution.ownMissed).toBe(1);
  });

  it("does not count a receiver typed as a class we do not define", () => {
    // `session.exec()` where Session comes from a library.
    const cg = graph(
      [fn("app/db.py", "exec")],
      [
        {
          fromFile: "app/views.py",
          fromFunction: "run",
          calleeName: "exec",
          toFile: null,
          toFunction: null,
          hasReceiver: true,
          calleeType: "Session",
        },
      ]
    );
    expect(buildFlowIndex(cg).resolution.ownMissed).toBe(0);
  });
});
