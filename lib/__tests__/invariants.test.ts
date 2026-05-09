// Cross-cutting invariants on CodeGraph. These properties should hold
// for ANY valid input — regardless of language, repo size, or shape.
//
// Two ways to read this file:
//   1. As regression coverage — break an invariant when refactoring
//      the extractor and these tests catch it.
//   2. As a contract — the rest of gitVision (blast_radius,
//      find_duplicates, signals, untested_hotspots) downstream of
//      buildCodeGraph relies on these properties. If they don't hold,
//      every consumer is suspect.
//
// We run each invariant against several hand-built scenarios so a single
// failure message identifies which input shape broke. Add scenarios to
// `scenarios()` rather than new top-level tests.
//
// To extend with NEW invariants: add another `describe("invariant: …")`
// block and loop over `scenarios()` inside `it.each`.
//
// To run these against a real repo's output (e.g. golang/go), see
// lib/__tests__/snapshot-invariants.test.ts (planned next step).

import { describe, it, expect } from "vitest";
import { buildCodeGraph } from "../codeAnalysis/codeGraph";
import type { ParsedFile, CodeGraph } from "../codeAnalysis/types";

// ----------------- helpers (mirrors codeGraph.test.ts pattern) -----------------

function pf(over: Partial<ParsedFile> & { rel: string }): ParsedFile {
  return {
    rel: over.rel,
    imports: over.imports ?? [],
    functions: over.functions ?? [],
    calls: over.calls ?? [],
    fileComplexity: over.fileComplexity ?? 1,
    parseError: over.parseError ?? false,
    ...(over.classes !== undefined ? { classes: over.classes } : {}),
  };
}

interface Scenario {
  name: string;
  graph: CodeGraph;
}

/** A small library of structurally diverse CodeGraphs. Any invariant that
 *  holds across all of these is unlikely to be over-fitted to one shape. */
function scenarios(): Scenario[] {
  return [
    {
      name: "empty input",
      graph: buildCodeGraph({ parsedFiles: [], pluginByFile: new Map() }),
    },
    {
      name: "single file, multiple functions",
      graph: buildCodeGraph({
        parsedFiles: [
          pf({
            rel: "src/a.ts",
            functions: [
              { name: "foo", startRow: 0, endRow: 10, complexity: 3 },
              { name: "bar", startRow: 12, endRow: 20, complexity: 2 },
            ],
            calls: [{ calleeName: "foo", inFunction: "bar" }],
          }),
        ],
        pluginByFile: new Map([["src/a.ts", "javascript"]]),
      }),
    },
    {
      name: "cross-file call resolution",
      graph: buildCodeGraph({
        parsedFiles: [
          pf({
            rel: "src/api.ts",
            functions: [
              { name: "fetchUser", startRow: 1, endRow: 10, complexity: 2 },
            ],
          }),
          pf({
            rel: "src/page.ts",
            functions: [
              { name: "render", startRow: 1, endRow: 30, complexity: 5 },
            ],
            calls: [{ calleeName: "fetchUser", inFunction: "render" }],
          }),
        ],
        pluginByFile: new Map([
          ["src/api.ts", "javascript"],
          ["src/page.ts", "javascript"],
        ]),
      }),
    },
    {
      name: "unresolved call (external library)",
      graph: buildCodeGraph({
        parsedFiles: [
          pf({
            rel: "src/x.ts",
            functions: [
              { name: "main", startRow: 0, endRow: 5, complexity: 1 },
            ],
            calls: [{ calleeName: "lodash_partition", inFunction: "main" }],
          }),
        ],
        pluginByFile: new Map([["src/x.ts", "javascript"]]),
      }),
    },
  ];
}

// ----------------- the invariants -----------------

describe("invariant: every function has complexity >= 1", () => {
  it.each(scenarios())("$name", ({ graph }) => {
    for (const fn of graph.functions) {
      expect(fn.complexity, `${fn.filePath}:${fn.name}`).toBeGreaterThanOrEqual(1);
    }
  });
});

describe("invariant: every resolved call edge points at a real function", () => {
  it.each(scenarios())("$name", ({ graph }) => {
    const fnKey = (file: string, name: string, container?: string) =>
      `${file}::${container ?? ""}::${name}`;
    const fnIndex = new Set(
      graph.functions.map((f) => fnKey(f.filePath, f.name, f.containerType))
    );

    for (const edge of graph.calls) {
      // Skip unresolved edges — they're allowed (external libs).
      if (edge.toFile === null || edge.toFunction === null) continue;
      const key = fnKey(edge.toFile, edge.toFunction, edge.toContainerType);
      expect(
        fnIndex.has(key),
        `resolved edge ${edge.fromFile}::${edge.fromFunction} → ${edge.toFile}::${edge.toFunction} ` +
          `points at a function that doesn't exist in graph.functions`
      ).toBe(true);
    }
  });
});

describe("invariant: call edge resolution is internally consistent", () => {
  it.each(scenarios())("$name", ({ graph }) => {
    for (const edge of graph.calls) {
      // Either both toFile and toFunction are set, or neither (unresolved).
      const hasFile = edge.toFile !== null;
      const hasFn = edge.toFunction !== null;
      expect(
        hasFile === hasFn,
        `edge ${edge.fromFile}::${edge.fromFunction} → ${edge.calleeName} has ` +
          `mismatched resolution: toFile=${edge.toFile} toFunction=${edge.toFunction}`
      ).toBe(true);
    }
  });
});

describe("invariant: byPlugin function counts sum to total functions", () => {
  it.each(scenarios())("$name", ({ graph }) => {
    const declared = Object.values(graph.byPlugin).reduce(
      (acc, stats) => acc + stats.functions,
      0
    );
    expect(declared).toBe(graph.functions.length);
  });
});

describe("invariant: no two functions share file + startRow + name", () => {
  it.each(scenarios())("$name", ({ graph }) => {
    const seen = new Set<string>();
    for (const fn of graph.functions) {
      const key = `${fn.filePath}:${fn.startRow}:${fn.name}:${fn.containerType ?? ""}`;
      expect(seen.has(key), `duplicate function entry: ${key}`).toBe(false);
      seen.add(key);
    }
  });
});

describe("invariant: every function has endRow >= startRow", () => {
  it.each(scenarios())("$name", ({ graph }) => {
    for (const fn of graph.functions) {
      expect(
        fn.endRow,
        `${fn.filePath}::${fn.name} has endRow=${fn.endRow} < startRow=${fn.startRow}`
      ).toBeGreaterThanOrEqual(fn.startRow);
    }
  });
});

describe("invariant: byPlugin call counts sum to total calls", () => {
  it.each(scenarios())("$name", ({ graph }) => {
    const declared = Object.values(graph.byPlugin).reduce(
      (acc, stats) => acc + stats.calls,
      0
    );
    expect(declared).toBe(graph.calls.length);
  });
});

describe("invariant: fileComplexity entries are positive integers", () => {
  it.each(scenarios())("$name", ({ graph }) => {
    for (const [path, complexity] of Object.entries(graph.fileComplexity)) {
      expect(path.length, "empty path key in fileComplexity").toBeGreaterThan(0);
      expect(Number.isInteger(complexity), `non-integer complexity for ${path}`).toBe(true);
      expect(complexity, `non-positive complexity for ${path}`).toBeGreaterThan(0);
    }
  });
});
