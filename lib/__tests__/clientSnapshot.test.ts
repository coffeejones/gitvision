// The server/client boundary for snapshots.
//
// app/session/[id]/layout.tsx hands the latest snapshot to two client
// components, so everything reachable from that prop is serialized into the RSC
// flight payload of EVERY tab in the workspace. The code graph rode along:
// measured on the zod session, /session/<id>/prs served 7,092,975 bytes against
// a 178,684-byte graph-free floor, with 34,687 occurrences of `toFile` in the
// HTML of a page about pull requests.
//
// Nothing crashed and nothing looked wrong, which is why it survived. These
// tests exist because the failure mode is invisible: the only symptom is a page
// that takes longer than it should.
//
// The type system does the hard part — client props take ClientSnapshot, so
// reaching for `snapshot.codeGraph` in a client component is a compile error
// rather than a silent 6 MB regression. What tsc CANNOT check is whether a page
// still passes the unstripped snapshot (codeGraph is optional, so a full
// snapshot satisfies ClientSnapshot structurally). That is the last assertion
// here.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import type { AnalysisSnapshot } from "../types";
import type { CodeGraph } from "../codeAnalysis/types";
import {
  toClientSnapshot,
  computeShellGraphCounts,
  buildPaletteIndex,
  MAX_PALETTE_FILES,
  MAX_PALETTE_FUNCTIONS,
  toCodeTabSnapshot,
} from "../clientSnapshot";

const ROOT = process.cwd();
const ROUTES_DIR = path.join(ROOT, "app", "session", "[id]");

function fn(name: string, filePath: string, complexity: number, containerType?: string) {
  return { name, filePath, complexity, containerType, startLine: 1, endLine: 2 };
}

/** A snapshot with a graph big enough to exercise both caps. */
function mockSnapshot(functionCount: number, fileCount: number): AnalysisSnapshot {
  const fileComplexity: Record<string, number> = {};
  for (let i = 0; i < fileCount; i++) fileComplexity[`src/f${i}.ts`] = i;
  const codeGraph = {
    functions: Array.from({ length: functionCount }, (_, i) =>
      fn(`fn${i}`, `src/f${i % Math.max(fileCount, 1)}.ts`, i, i % 3 === 0 ? "Cls" : undefined),
    ),
    classes: [{ name: "Cls", filePath: "src/f0.ts" }],
    calls: [],
    fileComplexity,
    contentHashes: {},
  } as unknown as CodeGraph;

  return {
    fetchedAt: "2026-08-02T00:00:00.000Z",
    repo: { fullName: "acme/widget", stars: 1 },
    fileGraph: { nodes: [{ id: "a" }, { id: "b" }], edges: [] },
    codeGraph,
  } as unknown as AnalysisSnapshot;
}

describe("toClientSnapshot", () => {
  it("removes the code graph", () => {
    const snap = mockSnapshot(5, 5);
    const client = toClientSnapshot(snap);
    expect("codeGraph" in client).toBe(false);
    // The whole point is the serialized size, so assert on the serialization
    // rather than the property: a graph reachable through some other field
    // would still be shipped.
    expect(JSON.stringify(client)).not.toContain("fileComplexity");
  });

  it("keeps everything else, untouched", () => {
    const snap = mockSnapshot(5, 5);
    const client = toClientSnapshot(snap);
    const { codeGraph: _drop, ...expected } = snap;
    expect(client).toEqual(expected);
  });

  it("does not mutate the snapshot it was given", () => {
    // Server components on the same request keep using the cached snapshot —
    // a delete would strip the graph out from under /code, which needs it.
    const snap = mockSnapshot(5, 5);
    toClientSnapshot(snap);
    expect(snap.codeGraph).toBeDefined();
  });

  it("survives a snapshot that never had a graph", () => {
    const snap = { fetchedAt: "x", repo: { fullName: "a/b" } } as unknown as AnalysisSnapshot;
    expect(() => toClientSnapshot(snap)).not.toThrow();
  });
});

describe("computeShellGraphCounts", () => {
  it("derives what the sidebar used to read off the graphs", () => {
    const counts = computeShellGraphCounts(mockSnapshot(7, 4));
    expect(counts).toEqual({
      hasGraph: true,
      hasCodeGraph: true,
      depCount: 2,
      codeFunctionCount: 7,
      classCount: 1,
    });
  });

  it("reports zeros rather than throwing on a graphless snapshot", () => {
    const snap = { fetchedAt: "x", repo: { fullName: "a/b" } } as unknown as AnalysisSnapshot;
    expect(computeShellGraphCounts(snap)).toEqual({
      hasGraph: false,
      hasCodeGraph: false,
      depCount: 0,
      codeFunctionCount: 0,
      classCount: 0,
    });
  });
});

describe("buildPaletteIndex", () => {
  it("reproduces exactly what the palette used to compute for itself", () => {
    // This is the regression that would matter to a user: the sort and the caps
    // moved from the browser to the server, and if either changed, Cmd+K would
    // quietly start offering different files and symbols.
    const snap = mockSnapshot(500, 500);
    const index = buildPaletteIndex(snap)!;
    const cg = snap.codeGraph!;

    const expectedFiles = Object.entries(cg.fileComplexity)
      .sort(([, a], [, b]) => b - a)
      .slice(0, MAX_PALETTE_FILES)
      .map(([path, complexity]) => ({ path, complexity }));
    expect(index.files).toEqual(expectedFiles);

    const expectedFns = [...cg.functions]
      .sort((a, b) => b.complexity - a.complexity)
      .slice(0, MAX_PALETTE_FUNCTIONS)
      .map((f) => ({
        name: f.name,
        filePath: f.filePath,
        containerType: f.containerType,
        complexity: f.complexity,
      }));
    expect(index.functions).toEqual(expectedFns);
  });

  it("caps both lists", () => {
    const index = buildPaletteIndex(mockSnapshot(5000, 5000))!;
    expect(index.files).toHaveLength(MAX_PALETTE_FILES);
    expect(index.functions).toHaveLength(MAX_PALETTE_FUNCTIONS);
  });

  it("carries only the fields the palette renders", () => {
    // Anything extra is dead weight on the wire, on every page.
    const index = buildPaletteIndex(mockSnapshot(3, 3))!;
    expect(Object.keys(index.files[0]).sort()).toEqual(["complexity", "path"]);
    expect(Object.keys(index.functions[0]).sort()).toEqual([
      "complexity",
      "containerType",
      "filePath",
      "name",
    ]);
  });

  it("returns null with no graph, the way the palette's own guard did", () => {
    const snap = { fetchedAt: "x", repo: { fullName: "a/b" } } as unknown as AnalysisSnapshot;
    expect(buildPaletteIndex(snap)).toBeNull();
  });
});

/** Every way a page can put the code graph on a client prop.
 *
 *  The first version of this guard looked for `snapshot={current}` only, and
 *  missed the biggest remaining leak in the codebase: /architecture passes
 *  `codeGraph={codeGraph}` to ArchitecturePanel, a client component, and shipped
 *  7,154,155 bytes to draw a class diagram. It went unnoticed because the panel
 *  is behind an entitlement — an unauthenticated curl renders the empty branch
 *  and looks clean. Measure while signed in, or on a demo session, and the whole
 *  graph is there.
 *
 *  So match the DESTINATION, not one spelling of it. */
function graphBearingProps(src: string): string[] {
  return [
    ...src.matchAll(/\b(snapshot|codeGraph)=\{(current|codeGraph|current\.codeGraph)\}/g),
  ].map((m) => m[0]);
}

describe("no route hands the code graph to a client component", () => {
  // tsc cannot catch this. `codeGraph` is optional on AnalysisSnapshot, so a
  // full snapshot is structurally a valid ClientSnapshot — a page that reverts
  // to `snapshot={current}` compiles cleanly and silently puts megabytes back
  // on the wire.
  //
  // /code is the one documented exception: it IS the code browser, and
  // CodePanel reads snapshot.codeGraph directly.
  const NEEDS_THE_GRAPH = new Set(["code"]);

  /** Every page under app/session/[id]/, INCLUDING the overview at the root.
   *  The first version enumerated only subdirectories and silently skipped
   *  page.tsx — the one route every visitor lands on. */
  function sessionPages(): { slug: string; file: string }[] {
    const pages = readdirSync(ROUTES_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .filter((d) => readdirSync(path.join(ROUTES_DIR, d.name)).includes("page.tsx"))
      .map((d) => ({ slug: d.name, file: path.join(ROUTES_DIR, d.name, "page.tsx") }));
    pages.push({ slug: "(overview)", file: path.join(ROUTES_DIR, "page.tsx") });
    return pages;
  }

  it("enumerates the overview, not just the sub-routes", () => {
    // Guards the enumeration itself: a fixed list that quietly matches nothing
    // is the same as no test at all.
    const slugs = sessionPages().map((p) => p.slug);
    expect(slugs).toContain("(overview)");
    expect(slugs).toContain("architecture");
    expect(slugs.length).toBeGreaterThan(12);
  });

  it.each(sessionPages())("$slug", ({ slug, file }) => {
    const offenders = graphBearingProps(readFileSync(file, "utf-8"));
    if (offenders.length === 0) return;
    expect(
      NEEDS_THE_GRAPH.has(slug),
      `${slug} puts the graph on a client prop (${offenders.join(", ")}) — pass a derived slice, or add "${slug}" to NEEDS_THE_GRAPH with a reason`,
    ).toBe(true);
  });

  it("keeps the session layout stripped — it pays on every tab", () => {
    const src = readFileSync(path.join(ROUTES_DIR, "layout.tsx"), "utf-8");
    expect(src).toContain("toClientSnapshot(current)");
    expect(graphBearingProps(src), "the layout passes the raw snapshot again").toEqual([]);
  });

  it("fails on both shapes of the leak it was written for", () => {
    // The guard is only worth its runtime if it fires on the code that shipped.
    // Run the REAL matcher over the REAL prior source of both regressions —
    // asserting a literal against itself would prove nothing about the guard.
    const layoutBefore = "<SessionShell sessionId={session.id} snapshot={current}>";
    const architectureBefore = "<ArchitecturePanel diagram={diagram} codeGraph={codeGraph}";
    expect(graphBearingProps(layoutBefore)).toEqual(["snapshot={current}"]);
    expect(graphBearingProps(architectureBefore)).toEqual(["codeGraph={codeGraph}"]);
    // …and stays quiet on the fixed forms, or every page would fail forever.
    expect(graphBearingProps("<SessionShell snapshot={clientSnapshot}>")).toEqual([]);
    expect(graphBearingProps("<ArchitecturePanel codeGraph={canvasGraph}")).toEqual([]);
  });
});

describe("the class diagram takes a slice, not the graph", () => {
  it("reads classes and nothing else", async () => {
    // `calls` is 89.8% of the zod graph (5.02 MB of 5.59 MB) and buildClassCanvas
    // never touches it. If a future edit reaches for it, the narrowed parameter
    // type fails to compile — but a cast would slip through, so assert the
    // behaviour too: a graph with ONLY classes must still produce a diagram.
    const { buildClassCanvas } = await import("../intelligence/classCanvas");
    const def = (name: string, filePath: string, extend?: string) => ({
      name,
      filePath,
      startRow: 1,
      endRow: 30,
      fields: [],
      methods: [],
      ...(extend ? { parentClass: extend } : {}),
    });
    const classesOnly = {
      classes: [def("A", "a.ts", "B"), def("B", "b.ts")],
    } as unknown as Parameters<typeof buildClassCanvas>[0];
    const result = buildClassCanvas(classesOnly);
    expect(result.nodes.map((n) => n.id).sort()).toEqual(["A", "B"]);
    // The edge matters more than the nodes: it proves the RELATIONSHIPS survive
    // the narrowing. A diagram of disconnected boxes would pass a node-only
    // assertion while having lost everything the page exists to show.
    expect(result.edges.map((e) => e.data.kind)).toEqual(["extends"]);
  });
});

describe("the refactor-safety route survives a partial session", () => {
  it("does not throw when a session has no snapshots array", async () => {
    // Observed live: /api/sessions/[id]/source, /drift and /refactor-safety all
    // 500'd on `session.snapshots.length` for a session object without the
    // array. `snapshots` is typed non-optional so tsc never asked, and the
    // existing `latest?.` only guarded the element, not the array.
    const { isSessionPrivate } = await import("../ownership");
    const partial = { id: "x", name: "x" } as unknown as Parameters<typeof isSessionPrivate>[0];
    expect(() => isSessionPrivate(partial)).not.toThrow();
    expect(isSessionPrivate(partial)).toBe(false);
  });
});

describe("toCodeTabSnapshot", () => {
  const cg = (calls: unknown[], extra: Record<string, unknown> = {}): CodeGraph =>
    ({
      functions: [], imports: [], calls, fileComplexity: {}, filesByExt: {},
      byPlugin: {}, generatedAt: "", ...extra,
    }) as unknown as CodeGraph;
  const snap = (graph: CodeGraph): AnalysisSnapshot =>
    ({ codeGraph: graph }) as unknown as AnalysisSnapshot;

  it("drops the unresolved call edges", () => {
    // Measured on NetBox: 81,013 edges, 8,230 resolved. `calls` is 17 MB of the
    // graph's 23 MB, and the Code tab is the one page that needs the graph
    // client-side at all.
    const out = toCodeTabSnapshot(
      snap(cg([
        { fromFile: "a.ts", toFile: "b.ts", calleeName: "f" },
        { fromFile: "a.ts", toFile: null, calleeName: "console.log" },
        { fromFile: "a.ts", calleeName: "parseInt" },
      ])),
    );
    expect(out.codeGraph!.calls).toHaveLength(1);
    expect(out.codeGraph!.calls[0].toFile).toBe("b.ts");
  });

  it("keeps everything else on the graph", () => {
    const out = toCodeTabSnapshot(snap(cg([], { fileComplexity: { "a.ts": 9 } })));
    expect(out.codeGraph!.fileComplexity).toEqual({ "a.ts": 9 });
  });

  it("passes a graph-free snapshot through untouched", () => {
    const s = { repo: "x" } as unknown as AnalysisSnapshot;
    expect(toCodeTabSnapshot(s)).toBe(s);
  });
});
