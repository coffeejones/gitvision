// The Watch monitor's noise filter is the most important design decision —
// it decides which verdict moves become an alert. Over-alerting kills the
// feature (people unsubscribe), so these lock in: only regressions, never
// improvements/unchanged/mixed, and tiny score wobbles are dropped.

import { describe, it, expect } from "vitest";
import { assessRegression } from "../watchMonitor";
import type { VerdictDelta } from "../intelligence/verdictDelta";

function delta(over: Partial<VerdictDelta>): VerdictDelta {
  return {
    scoreDelta: 0,
    grade: null,
    outcome: null,
    departments: [],
    criticalDelta: 0,
    direction: "unchanged",
    ...over,
  };
}

describe("assessRegression", () => {
  it("never alerts on improved / unchanged / mixed", () => {
    expect(assessRegression(delta({ direction: "improved", scoreDelta: 5 })).worthy).toBe(false);
    expect(assessRegression(delta({ direction: "unchanged" })).worthy).toBe(false);
    expect(assessRegression(delta({ direction: "mixed" })).worthy).toBe(false);
  });

  it("flags a regression with new high-severity findings as critical", () => {
    const a = assessRegression(
      delta({ direction: "regressed", scoreDelta: -8, criticalDelta: 2 }),
    );
    expect(a.worthy).toBe(true);
    expect(a.severity).toBe("critical");
  });

  it("flags a grade drop (no new criticals) as a regression", () => {
    const a = assessRegression(
      delta({ direction: "regressed", scoreDelta: -6, grade: { from: "B", to: "C" } }),
    );
    expect(a.worthy).toBe(true);
    expect(a.severity).toBe("regression");
  });

  it("flags a lens vote worsening as a regression", () => {
    const a = assessRegression(
      delta({
        direction: "regressed",
        scoreDelta: -4,
        departments: [{ id: "security", from: "pass", to: "fail" } as never],
      }),
    );
    expect(a.worthy).toBe(true);
    expect(a.severity).toBe("regression");
  });

  it("drops a tiny score wobble with no grade/lens/critical move", () => {
    const a = assessRegression(delta({ direction: "regressed", scoreDelta: -1 }));
    expect(a.worthy).toBe(false);
  });
});
