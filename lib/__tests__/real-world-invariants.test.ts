// Layer B of extraction testing: run the same invariants from
// invariants.test.ts against real source code (repojury's own lib/).
//
// Why "lib/"? It's the largest piece of TypeScript we own, hits multiple
// plugins (javascript), exercises cross-file resolution against tsconfig
// path mappings, and we don't have to clone anything to test it.
//
// The synthetic invariants (4 hand-built scenarios, 8 invariants = 32
// assertions) prove the rules hold on small, clean inputs. THESE
// invariants prove the rules hold on a real-world codebase with hundreds
// of functions and call edges. Real bugs hide in the long tail.
//
// If a synthetic invariant passes here too, the extractor is robust on
// medium-scale TypeScript. If it fails, the failure message tells you
// exactly which function/edge in lib/ broke the rule — go look at it.

import path from "node:path";
import { describe, it, expect, beforeAll } from "vitest";
import { analyzeDirectory } from "../codeAnalysis/analyze";
import { javascriptPlugin } from "../codeAnalysis/plugins/javascript";
import { regexFallbackPlugin } from "../codeAnalysis/plugins/regexFallback";
import type { CodeGraph } from "../codeAnalysis/types";

// We run the analyze pipeline once and reuse the result across all tests.
// analyzeDirectory parses ~50 TS files with tree-sitter; ~3-10 seconds.
let graph: CodeGraph;

beforeAll(async () => {
  const target = path.resolve(process.cwd(), "lib");
  const result = await analyzeDirectory(target, [
    javascriptPlugin,
    regexFallbackPlugin,
  ]);
  graph = result.codeGraph;
}, 30_000);

describe("real-world invariants on repojury's own lib/", () => {
  it("graph is non-empty (sanity)", () => {
    // If this fails, analyzeDirectory didn't find any TS — config issue.
    expect(graph.functions.length).toBeGreaterThan(50);
    expect(Object.keys(graph.fileComplexity).length).toBeGreaterThan(10);
  });

  it("invariant 1: every function has complexity >= 1", () => {
    const violators = graph.functions.filter((fn) => fn.complexity < 1);
    expect(
      violators,
      `${violators.length} functions have complexity < 1: ` +
        violators.slice(0, 3).map((f) => `${f.filePath}::${f.name}`).join(", ")
    ).toEqual([]);
  });

  it("invariant 2: every resolved call edge points at a real function", () => {
    const fnKey = (file: string, name: string, container?: string) =>
      `${file}::${container ?? ""}::${name}`;
    const fnIndex = new Set(
      graph.functions.map((f) => fnKey(f.filePath, f.name, f.containerType))
    );

    const violators = graph.calls.filter((edge) => {
      if (edge.toFile === null || edge.toFunction === null) return false;
      return !fnIndex.has(fnKey(edge.toFile, edge.toFunction, edge.toContainerType));
    });

    expect(
      violators,
      `${violators.length} resolved edges point at non-existent functions. ` +
        `First 3: ` +
        violators
          .slice(0, 3)
          .map((e) => `${e.fromFile}::${e.fromFunction} → ${e.toFile}::${e.toFunction}`)
          .join(" | ")
    ).toEqual([]);
  });

  it("invariant 3: call edge resolution is internally consistent", () => {
    const violators = graph.calls.filter((edge) => {
      const hasFile = edge.toFile !== null;
      const hasFn = edge.toFunction !== null;
      return hasFile !== hasFn;
    });
    expect(
      violators,
      `${violators.length} edges have mismatched toFile/toFunction nullability`
    ).toEqual([]);
  });

  it("invariant 4: byPlugin function counts sum to total functions", () => {
    const declared = Object.values(graph.byPlugin).reduce(
      (acc, stats) => acc + stats.functions,
      0
    );
    expect(declared).toBe(graph.functions.length);
  });

  it("invariant 5: no two functions share file + startRow + name + container", () => {
    const seen = new Set<string>();
    const dupes: string[] = [];
    for (const fn of graph.functions) {
      const key = `${fn.filePath}:${fn.startRow}:${fn.name}:${fn.containerType ?? ""}`;
      if (seen.has(key)) dupes.push(key);
      seen.add(key);
    }
    expect(dupes, `duplicate entries: ${dupes.slice(0, 3).join(", ")}`).toEqual([]);
  });

  it("invariant 6: every function has endRow >= startRow", () => {
    const violators = graph.functions.filter((fn) => fn.endRow < fn.startRow);
    expect(
      violators,
      `${violators.length} functions have endRow < startRow: ` +
        violators
          .slice(0, 3)
          .map((f) => `${f.filePath}::${f.name} (${f.startRow}..${f.endRow})`)
          .join(", ")
    ).toEqual([]);
  });

  it("invariant 7: byPlugin call counts sum to total calls", () => {
    const declared = Object.values(graph.byPlugin).reduce(
      (acc, stats) => acc + stats.calls,
      0
    );
    expect(declared).toBe(graph.calls.length);
  });

  it("invariant 8: fileComplexity entries are positive integers", () => {
    const violators: string[] = [];
    for (const [path, complexity] of Object.entries(graph.fileComplexity)) {
      if (path.length === 0) violators.push(`empty path key`);
      if (!Number.isInteger(complexity)) violators.push(`${path}: not integer (${complexity})`);
      if (complexity <= 0) violators.push(`${path}: <= 0 (${complexity})`);
    }
    expect(violators, violators.slice(0, 3).join(" | ")).toEqual([]);
  });
});
