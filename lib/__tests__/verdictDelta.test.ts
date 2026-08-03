import { describe, it, expect } from "vitest";
import { diffVerdict } from "../intelligence/verdictDelta";
import type {
  Verdict,
  DepartmentId,
  Vote,
  VerdictOutcome,
} from "../intelligence/verdict";

const ORDER: DepartmentId[] = ["health", "security", "forensics", "supply"];

/** Build a Verdict with just the fields diffVerdict reads, filling the
 *  rest minimally so it satisfies the type. */
function mkVerdict(
  score: number,
  grade: string,
  outcome: VerdictOutcome,
  votes: Record<DepartmentId, Vote>,
): Verdict {
  return {
    outcome,
    outcomeLabel: outcome,
    score,
    rawScore: score,
    grade,
    criticalCount: 0,
    summary: "",
    rulings: ORDER.map((id) => ({
      id,
      title: id,
      vote: votes[id],
      voteLabel: votes[id],
      reason: "",
      topSignals: [],
      signalCount: 0,
      flaggedSignalCount: 0,
      exploreSlug: "",
    })),
  };
}

const ALL_PASS: Record<DepartmentId, Vote> = {
  health: "pass",
  security: "pass",
  forensics: "pass",
  supply: "pass",
};

describe("diffVerdict", () => {
  it("reports an improvement when the score rises", () => {
    const prev = mkVerdict(50, "D+", "returned", {
      ...ALL_PASS,
      health: "fail",
      forensics: "fail",
      supply: "conditional",
    });
    const curr = mkVerdict(60, "C", "returned", {
      ...ALL_PASS,
      health: "fail",
      forensics: "conditional",
      supply: "conditional",
    });
    const d = diffVerdict(prev, curr, 3, 2);
    expect(d.direction).toBe("improved");
    expect(d.scoreDelta).toBe(10);
    expect(d.grade).toEqual({ from: "D+", to: "C" });
    expect(d.criticalDelta).toBe(-1);
    // forensics moved fail -> conditional
    expect(d.departments).toContainEqual({
      id: "forensics",
      from: "fail",
      to: "conditional",
    });
  });

  it("reports a regression when the score falls, with outcome change", () => {
    const prev = mkVerdict(100, "A", "cleared", ALL_PASS);
    const curr = mkVerdict(80, "B+", "conditional", {
      ...ALL_PASS,
      health: "conditional",
      forensics: "conditional",
    });
    const d = diffVerdict(prev, curr, 0, 0);
    expect(d.direction).toBe("regressed");
    expect(d.scoreDelta).toBe(-20);
    expect(d.grade).toEqual({ from: "A", to: "B+" });
    expect(d.outcome).toEqual({ from: "cleared", to: "conditional" });
    expect(d.departments).toHaveLength(2);
  });

  it("treats a flat score with more criticals as a regression", () => {
    // Same votes (Forensics already failing) but more high-sev findings
    // inside it: score holds, criticals rise -> substantive regression.
    const votes: Record<DepartmentId, Vote> = { ...ALL_PASS, forensics: "fail" };
    const prev = mkVerdict(80, "B+", "returned", votes);
    const curr = mkVerdict(80, "B+", "returned", votes);
    const d = diffVerdict(prev, curr, 1, 3);
    expect(d.direction).toBe("regressed");
    expect(d.scoreDelta).toBe(0);
    expect(d.grade).toBeNull();
    expect(d.outcome).toBeNull();
    expect(d.departments).toHaveLength(0);
    expect(d.criticalDelta).toBe(2);
  });

  it("is 'mixed' when the score is flat but votes shuffled", () => {
    const prev = mkVerdict(80, "B+", "conditional", {
      ...ALL_PASS,
      forensics: "conditional",
      supply: "pass",
    });
    // forensics improves to pass, supply slips to conditional -> net 0
    const curr = mkVerdict(80, "B+", "conditional", {
      ...ALL_PASS,
      forensics: "pass",
      supply: "conditional",
    });
    const d = diffVerdict(prev, curr, 0, 0);
    expect(d.direction).toBe("mixed");
    expect(d.scoreDelta).toBe(0);
    expect(d.departments).toHaveLength(2);
  });

  it("is 'unchanged' when nothing moved", () => {
    const v = mkVerdict(100, "A", "cleared", ALL_PASS);
    const d = diffVerdict(v, v, 0, 0);
    expect(d.direction).toBe("unchanged");
    expect(d.scoreDelta).toBe(0);
    expect(d.grade).toBeNull();
    expect(d.outcome).toBeNull();
    expect(d.departments).toHaveLength(0);
    expect(d.criticalDelta).toBe(0);
  });
});
