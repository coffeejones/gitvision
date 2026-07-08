// Unit coverage for the token-budget ranking in the blast_radius tool.

import { describe, it, expect } from "vitest";
import { rankAndBudget } from "../tools/blastRadius";

describe("rankAndBudget", () => {
  const tested = new Set<string>(["src/covered.ts"]);

  it("ranks untested → cross-module → nearest hop", () => {
    const entries = [
      { filePath: "src/covered.ts", hop: 1, crossModule: true }, // tested → sinks
      { filePath: "src/far.ts", hop: 3, crossModule: false }, // untested, far
      { filePath: "src/near-cm.ts", hop: 1, crossModule: true }, // untested + cm + near → top
      { filePath: "src/near.ts", hop: 1, crossModule: false }, // untested, near
    ];
    const { shown, total } = rankAndBudget(entries, tested, 1_000_000);
    expect(total).toBe(4);
    expect(shown.map((e) => e.filePath)).toEqual([
      "src/near-cm.ts",
      "src/near.ts",
      "src/far.ts",
      "src/covered.ts",
    ]);
    // untested flag is set correctly (test-set membership + isTestFile)
    expect(shown.find((e) => e.filePath === "src/near.ts")!.untested).toBe(true);
    expect(shown.find((e) => e.filePath === "src/covered.ts")!.untested).toBe(false);
  });

  it("caps to the char budget, keeping the highest-risk entries first", () => {
    const entries = Array.from({ length: 20 }, (_, i) => ({
      filePath: `src/file${i}.ts`,
      hop: 2,
      crossModule: i < 3, // first 3 are cross-module → highest risk
    }));
    const { shown, total } = rankAndBudget(entries, new Set(), 200);
    expect(total).toBe(20);
    expect(shown.length).toBeGreaterThan(0);
    expect(shown.length).toBeLessThan(20); // genuinely trimmed
    // the top-ranked (kept) entry is one of the cross-module ones
    expect(shown[0].crossModule).toBe(true);
  });

  it("always keeps at least one entry even with a tiny budget", () => {
    const entries = [{ filePath: "src/only.ts", hop: 1, crossModule: false }];
    const { shown } = rankAndBudget(entries, new Set(), 1);
    expect(shown.length).toBe(1);
  });

  it("preserves extra function-level fields at runtime", () => {
    const entries = [
      { filePath: "src/a.ts", hop: 1, crossModule: false, name: "parse", containerType: "Parser" },
    ];
    const { shown } = rankAndBudget(entries, new Set(), 1_000_000);
    // name/containerType survive the spread even though the type narrows them
    const row = shown[0] as unknown as Record<string, unknown>;
    expect(row.name).toBe("parse");
    expect(row.containerType).toBe("Parser");
  });
});
