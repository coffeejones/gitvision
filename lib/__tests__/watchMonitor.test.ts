// The Watch monitor's noise filter is the most important design decision —
// it decides which verdict moves become an alert. Over-alerting kills the
// feature (people unsubscribe), so these lock in: only regressions, never
// improvements/unchanged/mixed, and tiny score wobbles are dropped.

import { describe, it, expect } from "vitest";
import { assessRegression, assessWatch } from "../watchMonitor";
import type { VerdictDelta } from "../intelligence/verdictDelta";
import type { RiskDrift } from "../riskDrift";

const drift: RiskDrift = { file: "src/auth.ts", from: 12, to: 31, delta: 19 };

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

describe("assessWatch (risk drift as an independent trigger)", () => {
  it("fires a drift-only alert when the verdict held", () => {
    const a = assessWatch(delta({ direction: "unchanged" }), [drift]);
    expect(a.worthy).toBe(true);
    expect(a.severity).toBe("regression");
    expect(a.verdictRegressed).toBe(false);
  });

  it("fires a drift-only alert even when the verdict IMPROVED (not framed as a regression)", () => {
    // The bug the review caught: an improvement + blast growth must not report
    // verdictRegressed, so the email never says "dropped"/"regressed".
    const a = assessWatch(
      delta({ direction: "improved", scoreDelta: 8, grade: { from: "C", to: "B" } }),
      [drift],
    );
    expect(a.worthy).toBe(true);
    expect(a.verdictRegressed).toBe(false);
  });

  it("does not alert when neither the verdict regressed nor anything drifted", () => {
    const a = assessWatch(delta({ direction: "improved", scoreDelta: 5 }), []);
    expect(a.worthy).toBe(false);
    expect(a.verdictRegressed).toBe(false);
  });

  it("keeps the verdict severity + flags verdictRegressed on a real regression", () => {
    const a = assessWatch(
      delta({ direction: "regressed", scoreDelta: -8, criticalDelta: 2 }),
      [drift],
    );
    expect(a.worthy).toBe(true);
    expect(a.severity).toBe("critical");
    expect(a.verdictRegressed).toBe(true);
  });
});
