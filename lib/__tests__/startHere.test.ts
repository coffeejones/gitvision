import { describe, it, expect } from "vitest";
import { rankStartHere } from "../startHere";
import type { FileChips } from "../sourceAnnotations";

function chip(over: Partial<FileChips>): FileChips {
  return {
    isTest: false,
    tier: null,
    tested: null,
    fanIn: 0,
    untestedDependents: 0,
    complexity: null,
    duplicatedFns: 0,
    churn: null,
    authors: null,
    ...over,
  };
}

describe("rankStartHere", () => {
  it("ranks the most central (highest fan-in) file first", () => {
    const items = rankStartHere({
      "core.ts": chip({ fanIn: 20, complexity: 30 }),
      "leaf.ts": chip({ fanIn: 1, complexity: 40 }),
      "util.ts": chip({ fanIn: 8, complexity: 10 }),
    });
    expect(items[0].path).toBe("core.ts");
  });

  it("excludes test files — a newcomer shouldn't start in the tests", () => {
    const items = rankStartHere({
      "a.test.ts": chip({ isTest: true, fanIn: 99, complexity: 99 }),
      "a.ts": chip({ fanIn: 5, complexity: 12 }),
    });
    expect(items.map((i) => i.path)).toEqual(["a.ts"]);
  });

  it("drops files with no real signal (config / empty modules)", () => {
    const items = rankStartHere({
      "tsconfig.json": chip({ fanIn: 0, complexity: null }),
      "app.ts": chip({ fanIn: 4, complexity: 9 }),
    });
    expect(items.map((i) => i.path)).toEqual(["app.ts"]);
  });

  it("requires BOTH fan-in and substance — drops pure-vocabulary and unused files", () => {
    const items = rankStartHere({
      "types.ts": chip({ fanIn: 80, complexity: 1 }), // huge fan-in, no logic → drop
      "tokens.ts": chip({ fanIn: 40, complexity: 2 }), // design tokens → drop
      "unused-but-complex.ts": chip({ fanIn: 0, complexity: 30 }), // no centrality → drop
      "logic-hub.ts": chip({ fanIn: 12, complexity: 25 }), // central AND substantial → keep
    });
    expect(items.map((i) => i.path)).toEqual(["logic-hub.ts"]);
  });

  it("respects the limit", () => {
    const many: Record<string, FileChips> = {};
    for (let i = 0; i < 20; i++) many[`f${i}.ts`] = chip({ fanIn: i + 1, complexity: 10 });
    expect(rankStartHere(many, 5)).toHaveLength(5);
  });

  it("leads the reason with the strongest signal", () => {
    const [keystone] = rankStartHere({ "core.ts": chip({ fanIn: 24, complexity: 30 }) });
    expect(keystone.reason).toContain("24 files depend on this");

    const [loadBearing] = rankStartHere({ "lb.ts": chip({ fanIn: 2, tier: "load-bearing", complexity: 10 }) });
    expect(loadBearing.reason.toLowerCase()).toContain("load-bearing");

    const [complex] = rankStartHere({ "cx.ts": chip({ fanIn: 1, complexity: 18 }) });
    expect(complex.reason).toContain("complexity 18");
  });

  it("uses correct singular/plural grammar in the fan-in reason", () => {
    const [one] = rankStartHere({ "solo.ts": chip({ fanIn: 1, complexity: 10 }) });
    expect(one.reason).toBe("1 file depends on this");
    const [two] = rankStartHere({ "two.ts": chip({ fanIn: 2, complexity: 10 }) });
    expect(two.reason).toBe("2 files depend on this");
  });

  it("falls back to churn in the reason cascade", () => {
    const [churny] = rankStartHere({ "c.ts": chip({ fanIn: 1, complexity: 8, churn: 9 }) });
    expect(churny.reason).toContain("9 recent commits");
  });

  it("returns [] when nothing qualifies", () => {
    expect(rankStartHere({ "only.test.ts": chip({ isTest: true, fanIn: 9 }) })).toEqual([]);
    expect(rankStartHere({})).toEqual([]);
  });
});
