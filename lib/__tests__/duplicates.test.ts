// Tests for v0.30 duplicate detection:
//   - astHash._fnv1a64ForTest: FNV-1a hash determinism + distribution
//   - hashSubtree end-to-end: walks an actual tree-sitter AST and
//     verifies the structural-hash invariants we documented.
//   - findDuplicateGroups: filtering, sorting, cap, edge cases.
//
// We need a real tree-sitter parser for hashSubtree because the
// input shape (TsNode) isn't easily mockable. Using the JavaScript
// grammar since it's the smallest of the bundled WASMs (~1MB) and
// compiles fast in CI.

import { describe, it, expect, beforeAll } from "vitest";
import { Parser } from "web-tree-sitter";
import {
  hashSubtree,
  _fnv1a64ForTest as fnv1a64,
} from "../codeAnalysis/astHash";
import {
  findDuplicateGroups,
  summarizeDuplicates,
} from "../codeAnalysis/duplicates";
import { javascriptPlugin } from "../codeAnalysis/plugins/javascript";
import type { CodeGraph, FunctionDef } from "../codeAnalysis/types";

function emptyCodeGraph(): CodeGraph {
  return {
    functions: [],
    calls: [],
    imports: [],
    fileComplexity: {},
    filesByExt: {},
    byPlugin: {},
  };
}

function fn(over: Partial<FunctionDef> & { name: string }): FunctionDef {
  return {
    filePath: "src/x.ts",
    startRow: 0,
    endRow: 10,
    complexity: 5,
    ...over,
  };
}

// ------------------- FNV-1a hash basics -------------------

describe("fnv1a64", () => {
  it("returns a 16-character hex string", () => {
    const h = fnv1a64("hello");
    expect(h).toMatch(/^[0-9a-f]{16}$/);
  });

  it("is deterministic — same input → same output", () => {
    expect(fnv1a64("foo|bar|baz")).toBe(fnv1a64("foo|bar|baz"));
  });

  it("produces different hashes for different inputs", () => {
    expect(fnv1a64("foo")).not.toBe(fnv1a64("bar"));
    expect(fnv1a64("a")).not.toBe(fnv1a64("b"));
  });

  it("handles empty string without throwing", () => {
    expect(() => fnv1a64("")).not.toThrow();
  });

  it("handles long inputs", () => {
    const long = "x".repeat(10_000);
    const h = fnv1a64(long);
    expect(h).toMatch(/^[0-9a-f]{16}$/);
  });
});

// ------------------- hashSubtree end-to-end -------------------

describe("hashSubtree", () => {
  beforeAll(async () => {
    await javascriptPlugin.load();
  });

  /** Parse a JS expression and return the function body's AST node. */
  function parseFn(src: string) {
    const lang = javascriptPlugin.languageFor!("js");
    const parser = new Parser();
    parser.setLanguage(lang);
    const tree = parser.parse(src);
    if (!tree) throw new Error("parse failed");
    // Walk to find the first function_declaration
    function find(node: import("web-tree-sitter").Node): import("web-tree-sitter").Node | null {
      if (node.type === "function_declaration") return node;
      for (const c of node.namedChildren) {
        const f = find(c);
        if (f) return f;
      }
      return null;
    }
    const fnNode = find(tree.rootNode);
    if (!fnNode) throw new Error("no function found in source");
    const body = fnNode.childForFieldName("body");
    if (!body) throw new Error("function has no body");
    return body;
  }

  it("returns a 16-character hex string", () => {
    const body = parseFn("function f() { return 1; }");
    const h = hashSubtree(body);
    expect(h).toMatch(/^[0-9a-f]{16}$/);
  });

  it("produces identical hashes for functions that differ only in identifier names", () => {
    // The whole point of structural hashing — variable names are
    // explicitly excluded from the hash content.
    const a = parseFn("function f(x, y) { const z = x + y; return z; }");
    const b = parseFn("function g(a, b) { const c = a + b; return c; }");
    expect(hashSubtree(a)).toBe(hashSubtree(b));
  });

  it("produces identical hashes for functions that differ only in numeric literals", () => {
    const a = parseFn("function f() { return 1 + 2; }");
    const b = parseFn("function g() { return 100 + 200; }");
    expect(hashSubtree(a)).toBe(hashSubtree(b));
  });

  it("produces identical hashes for functions that differ only in string literals", () => {
    const a = parseFn("function f() { return 'hello'; }");
    const b = parseFn("function g() { return 'world'; }");
    expect(hashSubtree(a)).toBe(hashSubtree(b));
  });

  it("produces DIFFERENT hashes when the operator differs", () => {
    // Operators are captured explicitly via childForFieldName("operator")
    // — they're meaningful structural difference, not noise.
    const add = parseFn("function f(a, b) { return a + b; }");
    const mul = parseFn("function f(a, b) { return a * b; }");
    expect(hashSubtree(add)).not.toBe(hashSubtree(mul));
  });

  it("produces DIFFERENT hashes when control flow differs", () => {
    const if_ = parseFn("function f(x) { if (x) return 1; return 2; }");
    const while_ = parseFn(
      "function f(x) { while (x) return 1; return 2; }"
    );
    expect(hashSubtree(if_)).not.toBe(hashSubtree(while_));
  });

  it("produces DIFFERENT hashes when shape differs (extra branch)", () => {
    const simple = parseFn("function f(x) { return x; }");
    const branched = parseFn(
      "function f(x) { if (x) return x; return 0; }"
    );
    expect(hashSubtree(simple)).not.toBe(hashSubtree(branched));
  });

  it("hashes empty bodies consistently across calls", () => {
    const empty = parseFn("function f() {}");
    expect(hashSubtree(empty)).toBe(hashSubtree(empty));
  });
});

// ------------------- findDuplicateGroups -------------------

describe("findDuplicateGroups — basics", () => {
  it("returns an empty array for an empty code graph", () => {
    expect(findDuplicateGroups(emptyCodeGraph(), { minFileSpread: 1 })).toEqual([]);
  });

  it("returns an empty array when no functions share a hash", () => {
    const cg = emptyCodeGraph();
    cg.functions = [
      fn({ name: "a", bodyHash: "aaa" }),
      fn({ name: "b", bodyHash: "bbb" }),
      fn({ name: "c", bodyHash: "ccc" }),
    ];
    expect(findDuplicateGroups(cg, { minFileSpread: 1 })).toEqual([]);
  });

  it("groups functions sharing the same bodyHash", () => {
    const cg = emptyCodeGraph();
    cg.functions = [
      fn({ name: "a", filePath: "src/a.ts", bodyHash: "shared" }),
      fn({ name: "b", filePath: "src/b.ts", bodyHash: "shared" }),
      fn({ name: "c", filePath: "src/c.ts", bodyHash: "unique" }),
    ];
    const groups = findDuplicateGroups(cg, { minFileSpread: 1 });
    expect(groups).toHaveLength(1);
    expect(groups[0].members.map((m) => m.name).sort()).toEqual(["a", "b"]);
  });
});

describe("findDuplicateGroups — filtering", () => {
  it("excludes functions below the complexity floor (default 2)", () => {
    // The default moved 5 -> 2 when file spread became the primary
    // discriminator: complexity alone could not tell a copied helper from a
    // per-file idiom, and at 5 it was missing real cross-file duplication.
    const cg = emptyCodeGraph();
    cg.functions = [
      fn({ name: "trivial1", complexity: 1, bodyHash: "shape" }),
      fn({ name: "trivial2", complexity: 1, bodyHash: "shape" }),
    ];
    expect(findDuplicateGroups(cg, { minFileSpread: 1 })).toEqual([]);
  });

  it("includes functions exactly at the complexity floor", () => {
    const cg = emptyCodeGraph();
    cg.functions = [
      fn({ name: "a", complexity: 5, bodyHash: "shape" }),
      fn({ name: "b", complexity: 5, bodyHash: "shape" }),
    ];
    const groups = findDuplicateGroups(cg, { minFileSpread: 1 });
    expect(groups).toHaveLength(1);
  });

  it("respects a custom minComplexity option", () => {
    const cg = emptyCodeGraph();
    cg.functions = [
      fn({ name: "a", complexity: 3, bodyHash: "shape" }),
      fn({ name: "b", complexity: 3, bodyHash: "shape" }),
    ];
    expect(findDuplicateGroups(cg, { minComplexity: 3, minFileSpread: 1 })).toHaveLength(1);
    expect(findDuplicateGroups(cg, { minComplexity: 10, minFileSpread: 1 })).toEqual([]);
  });

  it("excludes functions without a bodyHash (legacy / missing data)", () => {
    const cg = emptyCodeGraph();
    cg.functions = [
      fn({ name: "a" }), // no bodyHash
      fn({ name: "b" }),
      fn({ name: "c", bodyHash: "shape" }),
      fn({ name: "d", bodyHash: "shape" }),
    ];
    const groups = findDuplicateGroups(cg, { minFileSpread: 1 });
    expect(groups).toHaveLength(1);
    expect(groups[0].members.map((m) => m.name).sort()).toEqual(["c", "d"]);
  });

  it("filters out single-member buckets (not duplicates)", () => {
    const cg = emptyCodeGraph();
    cg.functions = [fn({ name: "lonely", bodyHash: "shape" })];
    expect(findDuplicateGroups(cg, { minFileSpread: 1 })).toEqual([]);
  });

  it("groups same-file overloads as duplicates too (not just cross-file)", () => {
    // Two same-named-different-overload methods in the same file CAN be
    // legitimate refactor candidates if their bodies are identical.
    const cg = emptyCodeGraph();
    cg.functions = [
      fn({
        name: "init",
        filePath: "src/Foo.cs",
        containerType: "Foo",
        bodyHash: "shape",
      }),
      fn({
        name: "init",
        filePath: "src/Foo.cs",
        containerType: "Bar",
        bodyHash: "shape",
      }),
    ];
    const groups = findDuplicateGroups(cg, { minFileSpread: 1 });
    expect(groups).toHaveLength(1);
    expect(groups[0].members).toHaveLength(2);
  });
});

describe("findDuplicateGroups — sorting", () => {
  it("sorts by groupSize × maxComplexity descending (biggest fish first)", () => {
    const cg = emptyCodeGraph();
    cg.functions = [
      // group A: 2 members, max complexity 30 → score 60
      fn({ name: "a1", complexity: 30, bodyHash: "A" }),
      fn({ name: "a2", complexity: 25, bodyHash: "A" }),
      // group B: 5 members, max complexity 10 → score 50
      fn({ name: "b1", complexity: 10, bodyHash: "B" }),
      fn({ name: "b2", complexity: 8, bodyHash: "B" }),
      fn({ name: "b3", complexity: 7, bodyHash: "B" }),
      fn({ name: "b4", complexity: 6, bodyHash: "B" }),
      fn({ name: "b5", complexity: 5, bodyHash: "B" }),
      // group C: 10 members, max complexity 6 → score 60 (tie with A)
      ...Array.from({ length: 10 }, (_, i) =>
        fn({ name: `c${i}`, complexity: 6, bodyHash: "C" })
      ),
    ];
    const groups = findDuplicateGroups(cg, { minFileSpread: 1 });
    // C and A both score 60; tiebreaker is maxComplexity (A=30 wins)
    expect(groups[0].members[0].name.startsWith("a")).toBe(true);
    // C comes second (score 60, lower maxComplexity)
    expect(groups[1].members[0].name.startsWith("c")).toBe(true);
    // B comes third (score 50)
    expect(groups[2].members[0].name.startsWith("b")).toBe(true);
  });

  it("breaks score ties deterministically", () => {
    const cg = emptyCodeGraph();
    // Two groups with identical score (10 × 2 = 20)
    cg.functions = [
      fn({ name: "x1", filePath: "src/z.ts", complexity: 10, bodyHash: "X" }),
      fn({ name: "x2", filePath: "src/z.ts", complexity: 10, bodyHash: "X" }),
      fn({ name: "y1", filePath: "src/a.ts", complexity: 10, bodyHash: "Y" }),
      fn({ name: "y2", filePath: "src/a.ts", complexity: 10, bodyHash: "Y" }),
    ];
    // Same score, same maxComplexity, same group size — tie broken by
    // first member's filePath alphabetically (a.ts < z.ts → Y first)
    const groups = findDuplicateGroups(cg, { minFileSpread: 1 });
    expect(groups[0].members[0].filePath).toBe("src/a.ts");
    expect(groups[1].members[0].filePath).toBe("src/z.ts");
  });
});

describe("findDuplicateGroups — capping", () => {
  it("caps the result at the default limit (15)", () => {
    const cg = emptyCodeGraph();
    // 20 distinct duplicate groups
    for (let i = 0; i < 20; i++) {
      cg.functions.push(
        fn({ name: `${i}_a`, complexity: 100 - i, bodyHash: `g${i}` }),
        fn({ name: `${i}_b`, complexity: 100 - i, bodyHash: `g${i}` })
      );
    }
    expect(findDuplicateGroups(cg, { minFileSpread: 1 })).toHaveLength(15);
  });

  it("respects a custom limit option", () => {
    const cg = emptyCodeGraph();
    for (let i = 0; i < 10; i++) {
      cg.functions.push(
        fn({ name: `${i}_a`, complexity: 50 - i, bodyHash: `g${i}` }),
        fn({ name: `${i}_b`, complexity: 50 - i, bodyHash: `g${i}` })
      );
    }
    expect(findDuplicateGroups(cg, { limit: 3, minFileSpread: 1 })).toHaveLength(3);
    expect(findDuplicateGroups(cg, { limit: 100, minFileSpread: 1 })).toHaveLength(10);
  });
});

describe("summarizeDuplicates", () => {
  it("returns zeros for an empty groups list", () => {
    expect(summarizeDuplicates([])).toEqual({
      totalGroups: 0,
      totalDuplicateFunctions: 0,
      largestGroupSize: 0,
    });
  });

  it("aggregates totals correctly", () => {
    const groups = [
      {
        hash: "a",
        members: [
          fn({ name: "a1", bodyHash: "a" }),
          fn({ name: "a2", bodyHash: "a" }),
          fn({ name: "a3", bodyHash: "a" }),
        ],
        maxComplexity: 10,
      },
      {
        hash: "b",
        members: [fn({ name: "b1", bodyHash: "b" }), fn({ name: "b2", bodyHash: "b" })],
        maxComplexity: 5,
      },
    ];
    const s = summarizeDuplicates(groups);
    expect(s.totalGroups).toBe(2);
    expect(s.totalDuplicateFunctions).toBe(5); // 3 + 2
    expect(s.largestGroupSize).toBe(3);
  });
});

// File spread is the discriminator complexity alone could not provide.
// Measured on three repos: at a complexity floor of 1, NetBox reports one
// "group" of 288 identical test_name() methods — Django's own convention. At a
// floor of 5 the panel misses fileBasename() written eleven times in eleven
// files. Requiring both catches the second and rejects the first.
describe("findDuplicateGroups — copy-paste vs convention", () => {
  const fn = (name: string, filePath: string, hash: string, complexity = 3) => ({
    name, filePath, bodyHash: hash, complexity,
    startRow: 1, endRow: 5,
  });
  const graph = (functions: unknown[]) =>
    ({ functions, calls: [], imports: [], fileComplexity: {}, filesByExt: {}, byPlugin: {}, generatedAt: "" }) as never;

  it("reports a helper duplicated across many files", () => {
    const g = findDuplicateGroups(
      graph(["a", "b", "c", "d"].map((f) => fn("fileBasename", `components/${f}.tsx`, "H"))),
    );
    expect(g).toHaveLength(1);
    expect(g[0].members).toHaveLength(4);
  });

  it("does NOT report an idiom repeated inside one file", () => {
    // 288 copies of test_name() in one Django test module is a convention.
    const many = Array.from({ length: 20 }, (_, i) => fn(`test_${i}`, "tests/test_filtersets.py", "H", 1));
    expect(findDuplicateGroups(graph(many))).toEqual([]);
  });

  it("needs BOTH conditions — spread alone lets the pile-up through", () => {
    // Trivial one-liners spread across files are still not worth extracting.
    const trivial = ["a", "b", "c", "d"].map((f) => fn("getName", `src/${f}.ts`, "H", 1));
    expect(findDuplicateGroups(graph(trivial))).toEqual([]);
  });

  it("keeps both floors configurable", () => {
    const one = ["a", "a"].map((f) => fn("helper", `src/${f}.ts`, "H"));
    expect(findDuplicateGroups(graph(one))).toEqual([]);              // spread 1 < 2
    expect(findDuplicateGroups(graph(one), { minFileSpread: 1 })).toHaveLength(1);
  });

  it("counts a helper copied into exactly two files", () => {
    // Two files IS duplication. A higher floor was tried and reverted: the
    // panel's top 15 is identical at spread 2 and 3, so raising it only trims
    // real two-file clones out of the tail.
    const two = ["a", "b"].map((f) => fn("helper", `src/${f}.ts`, "H"));
    expect(findDuplicateGroups(graph(two))).toHaveLength(1);
  });
});
