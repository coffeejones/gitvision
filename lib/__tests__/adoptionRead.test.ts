// Tests for the adoption-read reweighting logic (The Read, Mode A).
//
// We inject synthetic Verdict + HealthSignals so these exercise the
// reweighting rules directly, decoupled from detector thresholds. The signal
// extraction itself is covered by signals.test.ts.

import { describe, it, expect } from "vitest";
import { computeAdoptionRead } from "../intelligence/adoptionRead";
import type { Verdict, VerdictOutcome } from "../intelligence/verdict";
import type { AnalysisSnapshot, HealthSignal, HealthSignals } from "../types";

function snap(over: Partial<AnalysisSnapshot> = {}): AnalysisSnapshot {
  return { ...over } as AnalysisSnapshot;
}

function verdict(
  outcome: VerdictOutcome,
  grade = "B",
  score = 80
): Verdict {
  return {
    outcome,
    outcomeLabel: outcome,
    score,
    rawScore: score,
    grade,
    summary: "",
    rulings: [],
  };
}

function sig(
  id: string,
  severity?: "low" | "medium" | "high"
): HealthSignal {
  return { id, title: id, detail: `${id} detail`, evidence: {}, severity };
}

function signals(over: Partial<HealthSignals> = {}): HealthSignals {
  return { working: [], needsWork: [], questions: [], ...over };
}

describe("computeAdoptionRead — base outcome mapping", () => {
  it("maps cleared -> ADOPT when nothing is flagged", () => {
    const r = computeAdoptionRead(snap(), verdict("cleared", "A"), signals());
    expect(r.read).toBe("ADOPT");
    expect(r.reconcile.why).toBeUndefined();
  });

  it("maps conditional -> GUARDED", () => {
    const r = computeAdoptionRead(snap(), verdict("conditional", "C"), signals());
    expect(r.read).toBe("GUARDED");
    expect(r.reconcile.why).toBeUndefined();
  });

  it("maps returned -> AVOID", () => {
    const r = computeAdoptionRead(snap(), verdict("returned", "E"), signals());
    expect(r.read).toBe("AVOID");
    expect(r.reconcile.why).toBeUndefined();
  });
});

describe("computeAdoptionRead — adoption-critical downgrades", () => {
  it("caps a cleared repo at GUARDED when bus-factor-risk fired", () => {
    const r = computeAdoptionRead(
      snap(),
      verdict("cleared", "A"),
      signals({ needsWork: [sig("bus-factor-risk", "high")] })
    );
    expect(r.read).toBe("GUARDED");
    expect(r.reconcile.why).toContain("bus factor");
    expect(r.criticalReasonId).toBe("bus-factor-risk");
  });

  it("caps a cleared repo at GUARDED when the project is stale", () => {
    const r = computeAdoptionRead(
      snap(),
      verdict("cleared", "A"),
      signals({ needsWork: [sig("stale", "medium")] })
    );
    expect(r.read).toBe("GUARDED");
    expect(r.reconcile.why).toContain("release cadence");
  });

  it("forces AVOID on runtime vulnerable deps, even from cleared", () => {
    const r = computeAdoptionRead(
      snap(),
      verdict("cleared", "A"),
      signals({ needsWork: [sig("vulnerable-deps", "high")] })
    );
    expect(r.read).toBe("AVOID");
    expect(r.reconcile.why).toContain("known CVEs");
  });

  it("forces AVOID and surfaces a hesitation when secrets are exposed", () => {
    const s = snap({
      secretFindings: {
        scannedFiles: 1,
        findings: [{ severity: "critical" } as never],
      } as never,
    });
    const r = computeAdoptionRead(s, verdict("cleared", "A"), signals());
    expect(r.read).toBe("AVOID");
    expect(r.hesitate[0].id).toBe("exposed-secrets");
    expect(r.criticalReasonId).toBe("exposed-secrets");
  });

  it("treats a solo-project question as a bus-factor downgrade + hesitation", () => {
    const r = computeAdoptionRead(
      snap(),
      verdict("cleared", "A"),
      signals({ questions: [sig("solo-project")] })
    );
    expect(r.read).toBe("GUARDED");
    expect(r.hesitate.some((h) => h.id === "solo-project")).toBe(true);
  });

  it("never UPGRADES — a returned verdict stays AVOID with no flags", () => {
    const r = computeAdoptionRead(snap(), verdict("returned", "E"), signals());
    expect(r.read).toBe("AVOID");
  });
});

describe("computeAdoptionRead — reasons + guardrails", () => {
  it("draws 'safe' reasons only from working signals, capped at 3", () => {
    const r = computeAdoptionRead(
      snap(),
      verdict("cleared", "A"),
      signals({
        working: [
          sig("fresh-deps"),
          sig("very-active"),
          sig("broad-ownership"),
          sig("commit-cadence"),
        ],
      })
    );
    expect(r.safe).toHaveLength(3);
    // fresh-deps + broad-ownership outrank commit-cadence in priority order
    expect(r.safe.map((s) => s.id)).toContain("fresh-deps");
    expect(r.safe.map((s) => s.id)).not.toContain("commit-cadence");
  });

  it("leaves 'safe' empty rather than inventing strengths from a passing lens", () => {
    const r = computeAdoptionRead(snap(), verdict("cleared", "A"), signals());
    expect(r.safe).toEqual([]);
  });

  it("maps each fired risk to a concrete guardrail", () => {
    const r = computeAdoptionRead(
      snap(),
      verdict("conditional", "C"),
      signals({ needsWork: [sig("stale", "medium"), sig("deprecated-deps", "medium")] })
    );
    expect(r.guardrails.some((g) => /pin the exact version/i.test(g))).toBe(true);
    expect(r.guardrails.some((g) => /migration/i.test(g))).toBe(true);
  });

  it("gives a default guardrail when nothing is flagged", () => {
    const r = computeAdoptionRead(snap(), verdict("cleared", "A"), signals());
    expect(r.guardrails).toHaveLength(1);
    expect(r.guardrails[0]).toMatch(/pin a known-good/i);
  });

  it("tags reasons with a friendly category, never a raw kebab id", () => {
    const r = computeAdoptionRead(
      snap(),
      verdict("conditional", "C"),
      signals({ needsWork: [sig("vulnerable-deps", "high")] })
    );
    expect(r.hesitate[0].tag).toBe("supply");
    expect(r.hesitate[0].tag).not.toContain("-");
  });
});

describe("computeAdoptionRead — defensive", () => {
  it("does not throw on an empty snapshot + empty signals", () => {
    expect(() =>
      computeAdoptionRead(snap(), verdict("cleared", "A"), signals())
    ).not.toThrow();
  });

  it("adds a scope note when only a subtree was analyzed", () => {
    const r = computeAdoptionRead(
      snap({ analyzedSubdir: "src/core" }),
      verdict("cleared", "A"),
      signals()
    );
    expect(r.scopeNote).toContain("src/core");
  });
});
