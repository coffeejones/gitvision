// Tests for the verification-rules engine (lib/codeAnalysis/verificationRules.ts).
//
// Three layers of coverage:
//   1. Framework — evaluator dispatcher: severity sort, impact-score
//      secondary sort, max-results cap, stable tiebreaker, empty input.
//   2. Helpers — isTestFile and moduleKeyOf for each of our 8 supported
//      languages' conventional test-layout patterns. Imperfect heuristics
//      need explicit coverage so we know what we cover and what we don't.
//   3. Rules — each of the four registered rules: positive case (fires),
//      negative case (doesn't fire), edge cases.

import { describe, it, expect } from "vitest";
import {
  evaluateVerificationRules,
  isTestFile,
  moduleKeyOf,
  registeredRules,
  type VerificationContext,
} from "../codeAnalysis/verificationRules";
import type {
  DiffResult,
  ChangedFunction,
  DiffSummary,
} from "../codeAnalysis/diffAware";

function ctx(changes: ChangedFunction[], summary?: Partial<DiffSummary>): VerificationContext {
  const filesChanged = new Set(changes.map((c) => c.filePath)).size;
  const added = changes.filter((c) => c.status === "added").length;
  const removed = changes.filter((c) => c.status === "removed").length;
  const modified = changes.filter((c) => c.status === "modified").length;
  const netDelta = changes.reduce((s, c) => s + (c.complexityDelta ?? 0), 0);
  return {
    diff: {
      summary: {
        filesChanged,
        functionsAdded: added,
        functionsRemoved: removed,
        functionsModified: modified,
        netComplexityDelta: netDelta,
        ...summary,
      },
      changes,
    },
  };
}

function modified(
  filePath: string,
  name: string,
  before: number,
  after: number,
  extra: Partial<ChangedFunction> = {}
): ChangedFunction {
  return {
    filePath,
    name,
    status: "modified",
    complexityBefore: before,
    complexityAfter: after,
    complexityDelta: after - before,
    ...extra,
  };
}

function added(
  filePath: string,
  name: string,
  complexity: number,
  extra: Partial<ChangedFunction> = {}
): ChangedFunction {
  return {
    filePath,
    name,
    status: "added",
    complexityAfter: complexity,
    ...extra,
  };
}

function removed(
  filePath: string,
  name: string,
  complexity: number,
  extra: Partial<ChangedFunction> = {}
): ChangedFunction {
  return {
    filePath,
    name,
    status: "removed",
    complexityBefore: complexity,
    ...extra,
  };
}

// ---------------- Framework ----------------

describe("evaluateVerificationRules — framework", () => {
  it("returns empty array for an empty diff", () => {
    const out = evaluateVerificationRules(ctx([]));
    expect(out).toEqual([]);
  });

  it("caps total output at maxResults=3 by default", () => {
    // 4 functions that all trigger removedFunctionWithImpact
    const changes: ChangedFunction[] = [
      removed("a.ts", "f1", 10),
      removed("a.ts", "f2", 8),
      removed("a.ts", "f3", 6),
      removed("a.ts", "f4", 4),
    ];
    const out = evaluateVerificationRules(ctx(changes));
    expect(out.length).toBeLessThanOrEqual(3);
  });

  it("respects custom maxResults", () => {
    const changes: ChangedFunction[] = [
      removed("a.ts", "f1", 10),
      removed("a.ts", "f2", 8),
      removed("a.ts", "f3", 6),
    ];
    const out = evaluateVerificationRules(ctx(changes), { maxResults: 1 });
    expect(out.length).toBe(1);
    expect(out[0].impactScore).toBe(10); // highest-impact suggestion wins
  });

  it("sorts by severity rank (critical > warning > info)", () => {
    // Force one of each: complexity bump triggers critical, removed
    // triggers warning, high net delta triggers info.
    const changes: ChangedFunction[] = [
      modified("src/app.py", "criticalOne", 5, 12),  // critical: +7 delta no tests
      removed("src/app.py", "warningOne", 5),         // warning: removed w/ complexity
    ];
    const c = ctx(changes, { netComplexityDelta: 25 });
    const out = evaluateVerificationRules(c, { maxResults: 5 });
    const severities = out.map((s) => s.severity);
    // critical first, warning second, info last
    expect(severities[0]).toBe("critical");
    expect(severities[severities.length - 1]).toBe("info");
  });

  it("within same severity, sorts by impact score descending", () => {
    const changes: ChangedFunction[] = [
      removed("a.ts", "small", 4),
      removed("a.ts", "big", 12),
      removed("a.ts", "medium", 8),
    ];
    const out = evaluateVerificationRules(ctx(changes), { maxResults: 5 });
    expect(out.map((s) => s.impactScore)).toEqual([12, 8, 4]);
  });

  it("provides stable ordering when impact scores tie", () => {
    // Two removals with identical complexity → tiebreaker on ruleId,
    // then on text. Run twice to confirm same order.
    const changes: ChangedFunction[] = [
      removed("a.ts", "zebra", 6),
      removed("a.ts", "apple", 6),
    ];
    const a = evaluateVerificationRules(ctx(changes), { maxResults: 5 });
    const b = evaluateVerificationRules(ctx(changes), { maxResults: 5 });
    expect(a.map((s) => s.text)).toEqual(b.map((s) => s.text));
  });

  it("returns only registered rules and nothing else", () => {
    expect(registeredRules().length).toBe(6);
    const ids = registeredRules().map((r) => r.id).sort();
    expect(ids).toEqual([
      "complexity-increase-without-test",
      "high-net-complexity-delta",
      "large-pr-overview",
      "multiple-removals-from-container",
      "new-complex-function-untested",
      "removed-function-with-impact",
    ]);
  });
});

// ---------------- isTestFile helper ----------------

describe("isTestFile", () => {
  const positives = [
    // Java
    "src/test/java/petclinic/owner/OwnerTests.java",
    "src/test/java/foo/BarTest.java",
    // Kotlin
    "src/test/kotlin/foo/BarTests.kt",
    // C#
    "tests/Foo.Tests/BarTests.cs",
    "src/Foo/BarTest.cs",
    // Python
    "tests/test_foo.py",
    "tests/subpkg/test_foo.py",
    "src/foo/test_bar.py",
    "src/foo_test.py",
    // Go
    "internal/pkg/foo_test.go",
    // JS/TS
    "src/__tests__/foo.ts",
    "src/foo.test.ts",
    "src/foo.spec.ts",
    "src/foo.test.tsx",
    "src/foo.spec.jsx",
    "src/foo.test.mjs",
    // PHP
    "tests/FooTest.php",
    "src/Foo/BarTest.php",
    // Ruby
    "spec/foo_spec.rb",
    "spec/models/foo_spec.rb",
    "lib/foo/spec/bar_spec.rb",
  ];
  for (const p of positives) {
    it(`recognizes ${p} as a test file`, () => {
      expect(isTestFile(p)).toBe(true);
    });
  }

  const negatives = [
    "src/main/java/petclinic/Owner.java",
    "src/foo.py",
    "lib/foo.rb",
    "lib/foo.go",
    "src/foo.ts",
    "Foo.cs",
    "src/Foo.php",
    "src/foo/testimony.py",        // word starting with "test" but not a test pattern
    "docs/spec.md",                 // spec in path but not a Ruby test
    "src/specifications/types.ts",  // word with "spec" but not _spec.rb
  ];
  for (const p of negatives) {
    it(`recognizes ${p} as NOT a test file`, () => {
      expect(isTestFile(p)).toBe(false);
    });
  }
});

// ---------------- moduleKeyOf helper ----------------

describe("moduleKeyOf", () => {
  it("strips Java src/main/<lang>/ prefix", () => {
    expect(moduleKeyOf("src/main/java/petclinic/owner/Owner.java")).toBe(
      "petclinic/owner"
    );
  });

  it("strips Java src/test/<lang>/ prefix so production + test share a module", () => {
    expect(moduleKeyOf("src/test/java/petclinic/owner/OwnerTests.java")).toBe(
      "petclinic/owner"
    );
  });

  it("strips JS/TS __tests__/ subdir", () => {
    expect(moduleKeyOf("src/app/__tests__/Foo.test.ts")).toBe("src/app");
  });

  it("strips Python leading tests/ folder", () => {
    expect(moduleKeyOf("tests/subpkg/test_foo.py")).toBe("subpkg");
  });

  it("strips Ruby leading spec/ folder", () => {
    expect(moduleKeyOf("spec/models/foo_spec.rb")).toBe("models");
  });

  it("preserves directory for files with no test-prefix conventions", () => {
    expect(moduleKeyOf("internal/pkg/foo_test.go")).toBe("internal/pkg");
  });

  it("returns empty string for top-level files", () => {
    expect(moduleKeyOf("Owner.java")).toBe("");
  });
});

// ---------------- Rule: complexityIncreaseWithoutTest ----------------

describe("Rule: complexity-increase-without-test", () => {
  it("fires when modified function gains > 5 complexity and no test changed", () => {
    const out = evaluateVerificationRules(
      ctx([modified("src/owner/Owner.java", "addPet", 3, 11)])
    );
    expect(out.length).toBe(1);
    expect(out[0].ruleId).toBe("complexity-increase-without-test");
    expect(out[0].severity).toBe("critical");
    expect(out[0].text).toContain("+8 cyclomatic complexity");
    expect(out[0].impactScore).toBe(8);
  });

  it("does NOT fire when delta is below 4 (threshold lowered 2026-05-14)", () => {
    const out = evaluateVerificationRules(
      ctx([modified("src/owner/Owner.java", "addPet", 3, 6)])  // delta=3
    );
    expect(out.filter((s) => s.ruleId === "complexity-increase-without-test")).toEqual([]);
  });

  it("does fire when delta is exactly 4 (inclusive threshold, catches load_dotenv-class changes)", () => {
    // Calibrated on real-world Flask 3.0.3→3.1.0: load_dotenv had Δ=4
    // and is a security-sensitive CLI path that should be flagged.
    const out = evaluateVerificationRules(
      ctx([modified("src/owner/Owner.java", "addPet", 3, 7)])  // delta=4
    );
    expect(
      out.some((s) => s.ruleId === "complexity-increase-without-test")
    ).toBe(true);
  });

  it("does NOT fire when a test file in the same module was changed", () => {
    const out = evaluateVerificationRules(
      ctx([
        modified("src/main/java/owner/Owner.java", "addPet", 3, 11),
        // Test in mirror src/test/java/owner/ — shares "owner" module key
        modified("src/test/java/owner/OwnerTests.java", "testAddPet", 1, 2),
      ])
    );
    expect(out.filter((s) => s.ruleId === "complexity-increase-without-test")).toEqual([]);
  });

  it("DOES fire when a test exists in a DIFFERENT module", () => {
    const out = evaluateVerificationRules(
      ctx([
        modified("src/main/java/owner/Owner.java", "addPet", 3, 11),
        // Test in a different module — doesn't help the owner module
        added("src/test/java/audit/AuditTests.java", "testLogger", 2),
      ])
    );
    expect(
      out.some((s) => s.ruleId === "complexity-increase-without-test")
    ).toBe(true);
  });

  it("ignores delta on test files themselves", () => {
    // Test file with growing complexity isn't a production-quality issue
    const out = evaluateVerificationRules(
      ctx([modified("src/test/java/owner/OwnerTests.java", "testAddPet", 3, 12)])
    );
    expect(
      out.filter((s) => s.ruleId === "complexity-increase-without-test")
    ).toEqual([]);
  });

  it("renders containerType when present (Owner.addPet not just addPet)", () => {
    const out = evaluateVerificationRules(
      ctx([
        modified("src/owner/Owner.java", "addPet", 3, 11, {
          containerType: "Owner",
        }),
      ])
    );
    expect(out[0].text).toContain("Owner.addPet");
  });
});

// ---------------- Rule: newComplexFunctionUntested ----------------

describe("Rule: new-complex-function-untested", () => {
  it("fires for new function with complexity >= 5 and no test in module", () => {
    const out = evaluateVerificationRules(
      ctx([added("src/owner/Validator.java", "validate", 7)])
    );
    expect(out[0].ruleId).toBe("new-complex-function-untested");
    expect(out[0].severity).toBe("warning");
    expect(out[0].impactScore).toBe(7);
  });

  it("does NOT fire below complexity threshold (now 4)", () => {
    const out = evaluateVerificationRules(
      ctx([added("src/owner/Validator.java", "validate", 3)])
    );
    expect(out.filter((s) => s.ruleId === "new-complex-function-untested")).toEqual([]);
  });

  it("does NOT fire when test in same module is also new", () => {
    const out = evaluateVerificationRules(
      ctx([
        added("src/main/java/owner/Validator.java", "validate", 7),
        added("src/test/java/owner/ValidatorTests.java", "testValidate", 2),
      ])
    );
    expect(out.filter((s) => s.ruleId === "new-complex-function-untested")).toEqual([]);
  });

  it("ignores added test functions themselves", () => {
    const out = evaluateVerificationRules(
      ctx([added("src/test/java/owner/ValidatorTests.java", "testValidate", 10)])
    );
    expect(out.filter((s) => s.ruleId === "new-complex-function-untested")).toEqual([]);
  });
});

// ---------------- Rule: removedFunctionWithImpact ----------------

describe("Rule: removed-function-with-impact", () => {
  it("fires for removed function with complexity >= 3", () => {
    const out = evaluateVerificationRules(
      ctx([removed("src/util/legacy.ts", "processOldRecord", 5)])
    );
    expect(out[0].ruleId).toBe("removed-function-with-impact");
    expect(out[0].severity).toBe("warning");
    expect(out[0].impactScore).toBe(5);
  });

  it("does NOT fire for trivial removals (complexity < 3)", () => {
    const out = evaluateVerificationRules(
      ctx([removed("src/util/legacy.ts", "getName", 1)])
    );
    expect(out.filter((s) => s.ruleId === "removed-function-with-impact")).toEqual([]);
  });

  it("ignores removed test functions", () => {
    const out = evaluateVerificationRules(
      ctx([removed("src/test/java/old/LegacyTest.java", "testRemoved", 5)])
    );
    expect(out.filter((s) => s.ruleId === "removed-function-with-impact")).toEqual([]);
  });
});

// ---------------- Rule: highNetComplexityDelta ----------------

describe("Rule: high-net-complexity-delta", () => {
  it("fires when summary.netComplexityDelta exceeds 20", () => {
    const out = evaluateVerificationRules(
      ctx([modified("a.ts", "f", 0, 25)], { netComplexityDelta: 25 })
    );
    expect(
      out.some((s) => s.ruleId === "high-net-complexity-delta")
    ).toBe(true);
    const item = out.find((s) => s.ruleId === "high-net-complexity-delta")!;
    expect(item.severity).toBe("info");
    expect(item.text).toContain("+25");
  });

  it("does NOT fire at the 10 threshold (must exceed; threshold lowered 2026-05-14)", () => {
    const out = evaluateVerificationRules(
      ctx([], { netComplexityDelta: 10 })
    );
    expect(out.filter((s) => s.ruleId === "high-net-complexity-delta")).toEqual([]);
  });

  it("does NOT fire when net delta is negative (refactor that simplifies)", () => {
    const out = evaluateVerificationRules(
      ctx([], { netComplexityDelta: -15 })
    );
    expect(out.filter((s) => s.ruleId === "high-net-complexity-delta")).toEqual([]);
  });

  it("emits exactly one suggestion regardless of how many functions changed", () => {
    const changes: ChangedFunction[] = [
      modified("a.ts", "f1", 1, 10),
      modified("b.ts", "f2", 2, 15),
      modified("c.ts", "f3", 3, 20),
    ];
    const out = evaluateVerificationRules(
      ctx(changes, { netComplexityDelta: 39 }),
      { maxResults: 10 }
    );
    expect(out.filter((s) => s.ruleId === "high-net-complexity-delta").length).toBe(1);
  });
});

// ---------------- Rule: multipleRemovalsFromContainer ----------------

describe("Rule: multiple-removals-from-container", () => {
  it("fires when 3+ methods are removed from the same container class", () => {
    // Mirrors the Flask 3.1.2 → 3.1.3 SecureCookieSession case that
    // motivated this rule — three trivial methods removed from one
    // class. Each is complexity 1 (below the per-function threshold)
    // but together they're an API-surface change.
    const out = evaluateVerificationRules(
      ctx([
        removed("src/flask/sessions.py", "__getitem__", 1, {
          containerType: "SecureCookieSession",
        }),
        removed("src/flask/sessions.py", "get", 1, {
          containerType: "SecureCookieSession",
        }),
        removed("src/flask/sessions.py", "setdefault", 1, {
          containerType: "SecureCookieSession",
        }),
      ])
    );
    const fired = out.filter(
      (s) => s.ruleId === "multiple-removals-from-container"
    );
    expect(fired).toHaveLength(1);
    expect(fired[0].severity).toBe("warning");
    expect(fired[0].text).toContain("SecureCookieSession");
    expect(fired[0].text).toContain("3 methods");
    expect(fired[0].impactScore).toBe(3);
  });

  it("does NOT fire when only 2 methods are removed from a container", () => {
    const out = evaluateVerificationRules(
      ctx([
        removed("x.ts", "a", 1, { containerType: "Foo" }),
        removed("x.ts", "b", 1, { containerType: "Foo" }),
      ])
    );
    expect(out.filter((s) => s.ruleId === "multiple-removals-from-container")).toEqual([]);
  });

  it("fires per-container when multiple containers each have 3+ removals", () => {
    const out = evaluateVerificationRules(
      ctx([
        // ClassA: 3 removals
        removed("a.ts", "x", 1, { containerType: "ClassA" }),
        removed("a.ts", "y", 1, { containerType: "ClassA" }),
        removed("a.ts", "z", 1, { containerType: "ClassA" }),
        // ClassB: 4 removals
        removed("b.ts", "p", 1, { containerType: "ClassB" }),
        removed("b.ts", "q", 1, { containerType: "ClassB" }),
        removed("b.ts", "r", 1, { containerType: "ClassB" }),
        removed("b.ts", "s", 1, { containerType: "ClassB" }),
      ]),
      { maxResults: 5 }
    );
    const fired = out.filter(
      (s) => s.ruleId === "multiple-removals-from-container"
    );
    expect(fired).toHaveLength(2);
    // Higher impactScore (4) sorts first
    expect(fired[0].impactScore).toBe(4);
    expect(fired[0].text).toContain("ClassB");
  });

  it("ignores top-level (no containerType) removals to avoid double-flagging", () => {
    // Top-level function removals are handled by removed-function-with-impact;
    // this rule is specifically for API-surface changes via class boundaries.
    const out = evaluateVerificationRules(
      ctx([
        removed("x.ts", "fn1", 1),
        removed("x.ts", "fn2", 1),
        removed("x.ts", "fn3", 1),
      ])
    );
    expect(out.filter((s) => s.ruleId === "multiple-removals-from-container")).toEqual([]);
  });

  it("ignores test files when grouping removals", () => {
    const out = evaluateVerificationRules(
      ctx([
        removed("src/test/java/owner/Tests.java", "testA", 1, { containerType: "Tests" }),
        removed("src/test/java/owner/Tests.java", "testB", 1, { containerType: "Tests" }),
        removed("src/test/java/owner/Tests.java", "testC", 1, { containerType: "Tests" }),
      ])
    );
    expect(out.filter((s) => s.ruleId === "multiple-removals-from-container")).toEqual([]);
  });
});

// ---------------- Rule: largePrOverview ----------------

describe("Rule: large-pr-overview", () => {
  it("fires when summary.filesChanged exceeds 10", () => {
    // Construct synthetic changes across 11 distinct files to push
    // filesChanged > 10.
    const changes: ChangedFunction[] = [];
    for (let i = 0; i < 11; i++) {
      changes.push(modified(`src/f${i}.ts`, "fn", 1, 2));
    }
    const out = evaluateVerificationRules(
      ctx(changes, { filesChanged: 11, netComplexityDelta: 11 }),
      { maxResults: 10 }
    );
    const fired = out.filter((s) => s.ruleId === "large-pr-overview");
    expect(fired).toHaveLength(1);
    expect(fired[0].severity).toBe("info");
    expect(fired[0].text).toContain("11 files");
  });

  it("does NOT fire at the 10-files threshold (must exceed)", () => {
    const changes: ChangedFunction[] = [];
    for (let i = 0; i < 10; i++) {
      changes.push(modified(`src/f${i}.ts`, "fn", 1, 2));
    }
    const out = evaluateVerificationRules(
      ctx(changes, { filesChanged: 10 }),
      { maxResults: 10 }
    );
    expect(out.filter((s) => s.ruleId === "large-pr-overview")).toEqual([]);
  });

  it("sorts below critical/warning when both fire (info severity)", () => {
    // Build a diff with both: 11 files (large-pr-overview fires, info)
    // + one critical function (complexity-increase, critical).
    const changes: ChangedFunction[] = [];
    for (let i = 0; i < 11; i++) {
      changes.push(modified(`src/f${i}.ts`, "fn", 1, 2));
    }
    // One critical-severity function bump
    changes.push(modified("src/hot.ts", "loadDotenv", 9, 13));
    const out = evaluateVerificationRules(
      ctx(changes, { filesChanged: 12, netComplexityDelta: 15 }),
      { maxResults: 10 }
    );
    // Critical first, info last
    expect(out[0].severity).toBe("critical");
    const overview = out.find((s) => s.ruleId === "large-pr-overview");
    expect(overview).toBeDefined();
    expect(overview!.severity).toBe("info");
  });
});

// ---------------- Realistic integration ----------------

describe("evaluateVerificationRules — realistic PR scenarios", () => {
  it("Spring petclinic style: addPet grew + no test in owner module", () => {
    const out = evaluateVerificationRules(
      ctx([
        modified("src/main/java/owner/Owner.java", "addPet", 6, 11, {
          containerType: "Owner",
        }),
        // Some unrelated test elsewhere
        added("src/test/java/audit/AuditTests.java", "testLog", 2),
      ])
    );
    expect(out.length).toBeGreaterThan(0);
    const first = out[0];
    expect(first.severity).toBe("critical");
    expect(first.text).toContain("Owner.addPet");
    expect(first.text).toContain("+5"); // exactly +5 — at threshold
  });

  it("Refactor PR: large function split into helpers, low complexity each", () => {
    // 1 big removal + 3 small additions. No critical signals because:
    //   - removal has complexity 18 → triggers warning
    //   - additions complexity 4-5 each → only one >= 5 fires (boundary)
    //   - no net delta over 20 if total is balanced
    const out = evaluateVerificationRules(
      ctx([
        removed("src/x.ts", "doEverything", 18),
        added("src/x.ts", "step1", 5),
        added("src/x.ts", "step2", 6),
        added("src/x.ts", "step3", 7),
      ], { netComplexityDelta: 0 })
    );
    // Should produce: 1 removed-with-impact + 3 new-complex-untested = 4 total
    // Capped to 3 by default.
    expect(out.length).toBe(3);
    // The removed function has highest impact (18) → wins top slot
    expect(out[0].ruleId).toBe("removed-function-with-impact");
    expect(out[0].impactScore).toBe(18);
  });

  it("Healthy PR: small change, test added, no signals fire", () => {
    const out = evaluateVerificationRules(
      ctx([
        modified("src/foo.ts", "small", 3, 5),  // +2, below threshold
        added("src/__tests__/foo.test.ts", "testSmall", 2),
      ])
    );
    expect(out).toEqual([]);
  });
});
