// Tests for diff-aware analysis (lib/codeAnalysis/diffAware.ts).
//
// Pure-data testing — uses synthetic CodeGraph fixtures so we exercise:
//   - added / removed / modified / unchanged classification
//   - complexity-based modification detection
//   - bodyHash-based modification detection (catches body-changed-but-
//     complexity-same)
//   - graceful fallback when bodyHash is missing on either side (legacy
//     snapshot compatibility)
//   - identity matching across (filePath, name, containerType) tuples
//   - summary aggregation (file count, added/removed/modified counts,
//     net complexity delta)
//   - sort order (filePath, then source row)
//   - includeUnchanged opt-in

import { describe, it, expect } from "vitest";
import { computeDiff } from "../codeAnalysis/diffAware";
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

function fn(partial: Partial<FunctionDef> & { filePath: string; name: string }): FunctionDef {
  return {
    startRow: 1,
    endRow: 10,
    complexity: 1,
    ...partial,
  };
}

describe("computeDiff — added / removed", () => {
  it("returns empty diff for two empty graphs", () => {
    const r = computeDiff(emptyCodeGraph(), emptyCodeGraph());
    expect(r.changes).toEqual([]);
    expect(r.summary).toEqual({
      filesChanged: 0,
      functionsAdded: 0,
      functionsRemoved: 0,
      functionsModified: 0,
      netComplexityDelta: 0,
    });
  });

  it("detects added functions (in head, not base)", () => {
    const base = emptyCodeGraph();
    const head = emptyCodeGraph();
    head.functions = [fn({ filePath: "src/new.ts", name: "newFn", complexity: 3 })];
    const r = computeDiff(base, head);
    expect(r.changes).toHaveLength(1);
    expect(r.changes[0]).toMatchObject({
      filePath: "src/new.ts",
      name: "newFn",
      status: "added",
      complexityAfter: 3,
    });
    expect(r.changes[0].complexityBefore).toBeUndefined();
    expect(r.summary.functionsAdded).toBe(1);
    expect(r.summary.filesChanged).toBe(1);
  });

  it("detects removed functions (in base, not head)", () => {
    const base = emptyCodeGraph();
    const head = emptyCodeGraph();
    base.functions = [fn({ filePath: "src/old.ts", name: "deletedFn", complexity: 5 })];
    const r = computeDiff(base, head);
    expect(r.changes).toHaveLength(1);
    expect(r.changes[0]).toMatchObject({
      filePath: "src/old.ts",
      name: "deletedFn",
      status: "removed",
      complexityBefore: 5,
    });
    expect(r.changes[0].complexityAfter).toBeUndefined();
    expect(r.summary.functionsRemoved).toBe(1);
  });

  it("treats a rename as remove+add (no rename detection in v1)", () => {
    const base = emptyCodeGraph();
    const head = emptyCodeGraph();
    base.functions = [fn({ filePath: "src/a.ts", name: "oldName", complexity: 4 })];
    head.functions = [fn({ filePath: "src/a.ts", name: "newName", complexity: 4 })];
    const r = computeDiff(base, head);
    expect(r.changes).toHaveLength(2);
    const statuses = r.changes.map((c) => c.status).sort();
    expect(statuses).toEqual(["added", "removed"]);
    expect(r.summary.functionsAdded).toBe(1);
    expect(r.summary.functionsRemoved).toBe(1);
  });
});

describe("computeDiff — modified by complexity", () => {
  it("detects modified function when complexity changes", () => {
    const base = emptyCodeGraph();
    const head = emptyCodeGraph();
    base.functions = [fn({ filePath: "src/x.ts", name: "f", complexity: 3, startRow: 10 })];
    head.functions = [fn({ filePath: "src/x.ts", name: "f", complexity: 7, startRow: 12 })];
    const r = computeDiff(base, head);
    expect(r.changes).toHaveLength(1);
    expect(r.changes[0]).toMatchObject({
      filePath: "src/x.ts",
      name: "f",
      status: "modified",
      complexityBefore: 3,
      complexityAfter: 7,
      complexityDelta: 4,
      startRowBefore: 10,
      startRowAfter: 12,
    });
    expect(r.summary.functionsModified).toBe(1);
    expect(r.summary.netComplexityDelta).toBe(4);
  });

  it("supports negative complexity delta (refactor that simplifies)", () => {
    const base = emptyCodeGraph();
    const head = emptyCodeGraph();
    base.functions = [fn({ filePath: "src/x.ts", name: "f", complexity: 12 })];
    head.functions = [fn({ filePath: "src/x.ts", name: "f", complexity: 5 })];
    const r = computeDiff(base, head);
    expect(r.changes[0].complexityDelta).toBe(-7);
    expect(r.summary.netComplexityDelta).toBe(-7);
  });

  it("sums net complexity delta across multiple modified functions", () => {
    const base = emptyCodeGraph();
    const head = emptyCodeGraph();
    base.functions = [
      fn({ filePath: "a.ts", name: "f1", complexity: 3 }),
      fn({ filePath: "b.ts", name: "f2", complexity: 5 }),
      fn({ filePath: "c.ts", name: "f3", complexity: 8 }),
    ];
    head.functions = [
      fn({ filePath: "a.ts", name: "f1", complexity: 7 }),  // +4
      fn({ filePath: "b.ts", name: "f2", complexity: 2 }),  // -3
      fn({ filePath: "c.ts", name: "f3", complexity: 8 }),  // 0, unchanged
    ];
    const r = computeDiff(base, head);
    expect(r.summary.functionsModified).toBe(2);
    expect(r.summary.netComplexityDelta).toBe(1);
  });
});

describe("computeDiff — modified by body (bodyHash) without complexity change", () => {
  it("detects body change when complexity is identical but hashes differ", () => {
    const base = emptyCodeGraph();
    const head = emptyCodeGraph();
    base.functions = [
      fn({ filePath: "src/x.ts", name: "f", complexity: 3, bodyHash: "deadbeef00000001" }),
    ];
    head.functions = [
      fn({ filePath: "src/x.ts", name: "f", complexity: 3, bodyHash: "deadbeef00000002" }),
    ];
    const r = computeDiff(base, head);
    expect(r.changes).toHaveLength(1);
    expect(r.changes[0]).toMatchObject({
      status: "modified",
      complexityDelta: 0,
      bodyChanged: true,
    });
    expect(r.summary.functionsModified).toBe(1);
    expect(r.summary.netComplexityDelta).toBe(0);
  });

  it("does NOT flag modified when both complexity and hash are identical", () => {
    const base = emptyCodeGraph();
    const head = emptyCodeGraph();
    base.functions = [
      fn({ filePath: "src/x.ts", name: "f", complexity: 3, bodyHash: "abc123" }),
    ];
    head.functions = [
      fn({ filePath: "src/x.ts", name: "f", complexity: 3, bodyHash: "abc123" }),
    ];
    const r = computeDiff(base, head);
    expect(r.changes).toEqual([]);
    expect(r.summary.functionsModified).toBe(0);
  });

  it("flags bodyChanged=false on modified-by-complexity-only when hashes are unexpectedly equal", () => {
    // Edge case: complexity differs but the structural hash doesn't. Could
    // happen if our complexity computation uses non-structural inputs (e.g.
    // raw token counts that include identifier renames). Defensive — we
    // still surface the modification, with bodyChanged=false to clarify
    // the structural shape didn't change.
    const base = emptyCodeGraph();
    const head = emptyCodeGraph();
    base.functions = [
      fn({ filePath: "src/x.ts", name: "f", complexity: 3, bodyHash: "samehash" }),
    ];
    head.functions = [
      fn({ filePath: "src/x.ts", name: "f", complexity: 5, bodyHash: "samehash" }),
    ];
    const r = computeDiff(base, head);
    expect(r.changes).toHaveLength(1);
    expect(r.changes[0]).toMatchObject({
      status: "modified",
      complexityDelta: 2,
      bodyChanged: false,
    });
  });
});

describe("computeDiff — bodyHash absent (legacy snapshot fallback)", () => {
  it("returns bodyChanged=undefined when base lacks hash", () => {
    const base = emptyCodeGraph();
    const head = emptyCodeGraph();
    base.functions = [fn({ filePath: "x.ts", name: "f", complexity: 5 })]; // no bodyHash
    head.functions = [fn({ filePath: "x.ts", name: "f", complexity: 7, bodyHash: "abc" })];
    const r = computeDiff(base, head);
    expect(r.changes[0].bodyChanged).toBeUndefined();
    // Still classified as modified — falls back to complexity check
    expect(r.changes[0].status).toBe("modified");
  });

  it("returns bodyChanged=undefined when head lacks hash", () => {
    const base = emptyCodeGraph();
    const head = emptyCodeGraph();
    base.functions = [fn({ filePath: "x.ts", name: "f", complexity: 5, bodyHash: "abc" })];
    head.functions = [fn({ filePath: "x.ts", name: "f", complexity: 7 })]; // no bodyHash
    const r = computeDiff(base, head);
    expect(r.changes[0].bodyChanged).toBeUndefined();
    expect(r.changes[0].status).toBe("modified");
  });

  it("can NOT detect body-changed when bodyHash is absent — falls back to complexity-only", () => {
    // This is the documented limitation. When neither side has a hash and
    // complexity is identical, the function looks unchanged even though
    // the body may have changed.
    const base = emptyCodeGraph();
    const head = emptyCodeGraph();
    base.functions = [fn({ filePath: "x.ts", name: "f", complexity: 3 })];
    head.functions = [fn({ filePath: "x.ts", name: "f", complexity: 3 })];
    const r = computeDiff(base, head);
    expect(r.changes).toEqual([]);
  });
});

describe("computeDiff — identity matching", () => {
  it("distinguishes same-named functions in different files", () => {
    const base = emptyCodeGraph();
    const head = emptyCodeGraph();
    base.functions = [
      fn({ filePath: "a.ts", name: "parse", complexity: 5 }),
      fn({ filePath: "b.ts", name: "parse", complexity: 10 }),
    ];
    head.functions = [
      fn({ filePath: "a.ts", name: "parse", complexity: 5 }), // unchanged
      fn({ filePath: "b.ts", name: "parse", complexity: 15 }), // modified
    ];
    const r = computeDiff(base, head);
    expect(r.changes).toHaveLength(1);
    expect(r.changes[0]).toMatchObject({
      filePath: "b.ts",
      status: "modified",
      complexityDelta: 5,
    });
  });

  it("distinguishes same-named methods in different classes (Java overloads)", () => {
    const base = emptyCodeGraph();
    const head = emptyCodeGraph();
    base.functions = [
      fn({ filePath: "x.java", name: "validate", containerType: "User", complexity: 3 }),
      fn({ filePath: "x.java", name: "validate", containerType: "Pet", complexity: 4 }),
    ];
    head.functions = [
      fn({ filePath: "x.java", name: "validate", containerType: "User", complexity: 3 }),
      fn({ filePath: "x.java", name: "validate", containerType: "Pet", complexity: 9 }), // +5
    ];
    const r = computeDiff(base, head);
    expect(r.changes).toHaveLength(1);
    expect(r.changes[0]).toMatchObject({
      filePath: "x.java",
      name: "validate",
      containerType: "Pet",
      complexityDelta: 5,
    });
    expect(r.summary.functionsModified).toBe(1);
  });

  it("treats undefined and missing containerType as equivalent", () => {
    // A module-level function has containerType undefined. If for some
    // reason the snapshot serializes it as absent vs explicitly undefined,
    // the identity key should still match.
    const base = emptyCodeGraph();
    const head = emptyCodeGraph();
    base.functions = [{ filePath: "x.ts", name: "topLevel", startRow: 1, endRow: 5, complexity: 2 }];
    head.functions = [{ filePath: "x.ts", name: "topLevel", startRow: 1, endRow: 5, complexity: 4, containerType: undefined }];
    const r = computeDiff(base, head);
    expect(r.changes).toHaveLength(1);
    expect(r.changes[0].status).toBe("modified");
  });
});

describe("computeDiff — summary aggregation", () => {
  it("counts distinct files changed (not function count)", () => {
    const base = emptyCodeGraph();
    const head = emptyCodeGraph();
    base.functions = [
      fn({ filePath: "a.ts", name: "f1", complexity: 3 }),
      fn({ filePath: "a.ts", name: "f2", complexity: 4 }),
      fn({ filePath: "b.ts", name: "f3", complexity: 5 }),
    ];
    head.functions = [
      fn({ filePath: "a.ts", name: "f1", complexity: 5 }),  // modified
      fn({ filePath: "a.ts", name: "f2", complexity: 8 }),  // modified — same file
      fn({ filePath: "b.ts", name: "f3", complexity: 5 }),  // unchanged
      fn({ filePath: "c.ts", name: "f4", complexity: 1 }),  // added — new file
    ];
    const r = computeDiff(base, head);
    expect(r.summary.filesChanged).toBe(2); // a.ts (2 modified) + c.ts (1 added). b.ts unchanged.
    expect(r.summary.functionsModified).toBe(2);
    expect(r.summary.functionsAdded).toBe(1);
  });

  it("does not count unchanged functions in summary even when includeUnchanged is true", () => {
    const base = emptyCodeGraph();
    const head = emptyCodeGraph();
    base.functions = [
      fn({ filePath: "a.ts", name: "stable", complexity: 3, bodyHash: "h1" }),
      fn({ filePath: "b.ts", name: "changing", complexity: 5, bodyHash: "h2" }),
    ];
    head.functions = [
      fn({ filePath: "a.ts", name: "stable", complexity: 3, bodyHash: "h1" }),
      fn({ filePath: "b.ts", name: "changing", complexity: 9, bodyHash: "h3" }),
    ];
    const r = computeDiff(base, head, { includeUnchanged: true });
    expect(r.changes).toHaveLength(2);
    expect(r.changes.map((c) => c.status).sort()).toEqual(["modified", "unchanged"]);
    // Summary still only counts modified
    expect(r.summary.filesChanged).toBe(1);
    expect(r.summary.functionsModified).toBe(1);
  });
});

describe("computeDiff — output ordering", () => {
  it("sorts changes by filePath then by source row", () => {
    const base = emptyCodeGraph();
    const head = emptyCodeGraph();
    base.functions = [
      fn({ filePath: "b.ts", name: "f", complexity: 1, startRow: 5 }),
      fn({ filePath: "a.ts", name: "g", complexity: 1, startRow: 30 }),
      fn({ filePath: "a.ts", name: "h", complexity: 1, startRow: 5 }),
    ];
    head.functions = [
      fn({ filePath: "b.ts", name: "f", complexity: 9, startRow: 5 }),    // a:30, b:5 in head
      fn({ filePath: "a.ts", name: "g", complexity: 9, startRow: 30 }),
      fn({ filePath: "a.ts", name: "h", complexity: 9, startRow: 5 }),
    ];
    const r = computeDiff(base, head);
    expect(r.changes.map((c) => `${c.filePath}@${c.startRowAfter}`)).toEqual([
      "a.ts@5",
      "a.ts@30",
      "b.ts@5",
    ]);
  });

  it("uses post-diff row when available, falls back to before-row for removed", () => {
    const base = emptyCodeGraph();
    const head = emptyCodeGraph();
    base.functions = [
      fn({ filePath: "x.ts", name: "removed", complexity: 1, startRow: 20 }),
    ];
    head.functions = [
      fn({ filePath: "x.ts", name: "added", complexity: 1, startRow: 10 }),
    ];
    const r = computeDiff(base, head);
    expect(r.changes[0].name).toBe("added"); // row 10 < row 20
    expect(r.changes[1].name).toBe("removed");
  });
});

describe("computeDiff — includeUnchanged option", () => {
  it("excludes unchanged functions by default", () => {
    const base = emptyCodeGraph();
    const head = emptyCodeGraph();
    base.functions = [
      fn({ filePath: "a.ts", name: "f1", complexity: 3, bodyHash: "same" }),
      fn({ filePath: "a.ts", name: "f2", complexity: 5, bodyHash: "before" }),
    ];
    head.functions = [
      fn({ filePath: "a.ts", name: "f1", complexity: 3, bodyHash: "same" }),
      fn({ filePath: "a.ts", name: "f2", complexity: 9, bodyHash: "after" }),
    ];
    const r = computeDiff(base, head);
    expect(r.changes).toHaveLength(1);
    expect(r.changes[0].name).toBe("f2");
  });

  it("includes unchanged functions when opted in", () => {
    const base = emptyCodeGraph();
    const head = emptyCodeGraph();
    base.functions = [
      fn({ filePath: "a.ts", name: "stable", complexity: 3, bodyHash: "h1" }),
      fn({ filePath: "a.ts", name: "changed", complexity: 5, bodyHash: "h2" }),
    ];
    head.functions = [
      fn({ filePath: "a.ts", name: "stable", complexity: 3, bodyHash: "h1" }),
      fn({ filePath: "a.ts", name: "changed", complexity: 9, bodyHash: "h3" }),
    ];
    const r = computeDiff(base, head, { includeUnchanged: true });
    expect(r.changes).toHaveLength(2);
    const byName = Object.fromEntries(r.changes.map((c) => [c.name, c.status]));
    expect(byName.stable).toBe("unchanged");
    expect(byName.changed).toBe("modified");
  });
});

describe("computeDiff — realistic PR scenarios", () => {
  it("Spring petclinic PR: addPet gets new validation branch", () => {
    // Realistic scenario from the eval data: Owner.addPet gets a new
    // duplicate-name validation branch. Complexity rises, body shape
    // changes, hash differs.
    const base = emptyCodeGraph();
    const head = emptyCodeGraph();
    base.functions = [
      fn({
        filePath: "src/main/java/owner/Owner.java",
        name: "addPet",
        containerType: "Owner",
        complexity: 6,
        startRow: 120,
        bodyHash: "before_addpet",
      }),
      fn({
        filePath: "src/main/java/owner/Owner.java",
        name: "getPet",
        containerType: "Owner",
        complexity: 2,
        bodyHash: "unchanged_getpet",
      }),
      fn({
        filePath: "src/main/java/owner/PetController.java",
        name: "processCreationForm",
        containerType: "PetController",
        complexity: 7,
        bodyHash: "unchanged_processform",
      }),
    ];
    head.functions = [
      fn({
        filePath: "src/main/java/owner/Owner.java",
        name: "addPet",
        containerType: "Owner",
        complexity: 11,  // +5 from new branch
        startRow: 120,
        bodyHash: "after_addpet",
      }),
      fn({
        filePath: "src/main/java/owner/Owner.java",
        name: "getPet",
        containerType: "Owner",
        complexity: 2,
        bodyHash: "unchanged_getpet",
      }),
      fn({
        filePath: "src/main/java/owner/PetController.java",
        name: "processCreationForm",
        containerType: "PetController",
        complexity: 7,
        bodyHash: "unchanged_processform",
      }),
    ];
    const r = computeDiff(base, head);
    expect(r.changes).toHaveLength(1);
    expect(r.changes[0]).toMatchObject({
      name: "addPet",
      containerType: "Owner",
      status: "modified",
      complexityBefore: 6,
      complexityAfter: 11,
      complexityDelta: 5,
      bodyChanged: true,
    });
    expect(r.summary).toMatchObject({
      filesChanged: 1,
      functionsModified: 1,
      netComplexityDelta: 5,
    });
  });

  it("Refactor PR: function split into helpers (1 removed + 3 added)", () => {
    const base = emptyCodeGraph();
    const head = emptyCodeGraph();
    base.functions = [
      fn({ filePath: "x.ts", name: "doEverything", complexity: 18 }),
    ];
    head.functions = [
      fn({ filePath: "x.ts", name: "step1", complexity: 5 }),
      fn({ filePath: "x.ts", name: "step2", complexity: 6 }),
      fn({ filePath: "x.ts", name: "step3", complexity: 4 }),
    ];
    const r = computeDiff(base, head);
    expect(r.summary).toMatchObject({
      filesChanged: 1,
      functionsAdded: 3,
      functionsRemoved: 1,
      functionsModified: 0,
    });
  });

  it("Empty PR: only formatting / comment changes, no AST shifts", () => {
    // Edge case: PR touches a file but doesn't structurally change any
    // function. With bodyHash, this looks unchanged. Without bodyHash, we
    // also see no change (no complexity shifts). Either way, summary is
    // empty.
    const base = emptyCodeGraph();
    const head = emptyCodeGraph();
    base.functions = [fn({ filePath: "x.ts", name: "f", complexity: 3, bodyHash: "same" })];
    head.functions = [fn({ filePath: "x.ts", name: "f", complexity: 3, bodyHash: "same" })];
    const r = computeDiff(base, head);
    expect(r.changes).toEqual([]);
    expect(r.summary.filesChanged).toBe(0);
  });
});
