// Coverage for the risk-drift detector (lib/riskDrift.ts).

import { describe, it, expect } from "vitest";
import { computeRiskDrift, formatRiskDrift } from "../riskDrift";
import type { CodeGraph } from "../codeAnalysis/types";

/** Build a graph whose per-file fan-in matches `fanins` — for each target, N
 *  distinct (non-test) source files import it. */
function cgWithFanIn(fanins: Record<string, number>): CodeGraph {
  const imports: Array<{ from: string; to: string }> = [];
  for (const [target, n] of Object.entries(fanins)) {
    const key = target.replace(/\W/g, "");
    for (let i = 0; i < n; i++) {
      imports.push({ from: `src/dep_${key}_${i}.ts`, to: target });
    }
  }
  return {
    functions: [],
    calls: [],
    imports,
    fileComplexity: {},
    filesByExt: {},
    byPlugin: {},
    generatedAt: "",
  } as unknown as CodeGraph;
}

describe("computeRiskDrift", () => {
  const prev = cgWithFanIn({
    "src/auth.ts": 12,
    "src/hub.ts": 40,
    "src/small.ts": 3,
    "src/leaf.ts": 2,
    "src/stable.ts": 20,
  });
  const next = cgWithFanIn({
    "src/auth.ts": 31, // +19, load-bearing → flagged
    "src/hub.ts": 44, // +4 on a 40-hub, below the scaled floor (10) → ignored
    "src/small.ts": 9, // 3→9, now load-bearing, +6 → flagged
    "src/leaf.ts": 7, // grew but still under the load-bearing floor → ignored
    "src/new.ts": 10, // 0→10, new load-bearing file → flagged
    "src/stable.ts": 20, // unchanged → ignored
  });

  it("flags files that grew meaningfully and are load-bearing now", () => {
    const drifts = computeRiskDrift(prev, next);
    // worst-first by growth: auth (+19), new (+10), small (+6)
    expect(drifts.map((d) => d.file)).toEqual([
      "src/auth.ts",
      "src/new.ts",
      "src/small.ts",
    ]);
    expect(drifts[0]).toMatchObject({ file: "src/auth.ts", from: 12, to: 31, delta: 19 });
    expect(drifts.find((d) => d.file === "src/new.ts")).toMatchObject({ from: 0, to: 10 });
  });

  it("ignores sub-floor files, big-hub wobble, and steady files", () => {
    const flagged = new Set(computeRiskDrift(prev, next).map((d) => d.file));
    expect(flagged.has("src/leaf.ts")).toBe(false); // to < 8
    expect(flagged.has("src/hub.ts")).toBe(false); // +4 below scaled floor
    expect(flagged.has("src/stable.ts")).toBe(false); // no change
  });

  it("honours the limit", () => {
    expect(computeRiskDrift(prev, next, 2).map((d) => d.file)).toEqual([
      "src/auth.ts",
      "src/new.ts",
    ]);
  });

  it("returns nothing when nothing drifted", () => {
    expect(computeRiskDrift(prev, prev)).toEqual([]);
  });
});

describe("formatRiskDrift", () => {
  it("renders a compact basename one-liner", () => {
    const drifts = computeRiskDrift(
      cgWithFanIn({ "src/auth/session.ts": 8 }),
      cgWithFanIn({ "src/auth/session.ts": 20 })
    );
    expect(formatRiskDrift(drifts)).toBe("session.ts blast 8→20");
  });
});
