import { describe, it, expect } from "vitest";
import {
  buildUnifiedFindings,
  SEVERITY_RANK,
} from "../security/unifiedFindings";
import type { SecretFinding, SecretSeverity } from "../security/types";
import type { RiskyPatternFinding } from "../security/riskyPatterns";

function secret(severity: SecretSeverity, filePath: string): SecretFinding {
  return {
    filePath,
    line: 1,
    patternId: "p",
    patternLabel: "Test credential",
    preview: "AKIA...***",
    severity,
    confidence: 1,
  };
}

function pattern(filePath: string): RiskyPatternFinding {
  return {
    patternId: "p",
    patternName: "eval",
    filePath,
    line: 1,
    snippet: "eval(x)",
  };
}

describe("buildUnifiedFindings", () => {
  it("caps a critical secret at 'high' in the unified list (no critical tier)", () => {
    const out = buildUnifiedFindings([], [secret("critical", "aws.ts")], []);
    expect(out).toHaveLength(1);
    // A leaked AWS key is "critical" in the Secrets panel, but the mixed list
    // has no tier above "high" — it must map there, not leak "critical".
    expect(out[0].severity).toBe("high");
    // Regression guard for the NaN sort: every unified severity has a rank.
    expect(SEVERITY_RANK[out[0].severity]).toBeTypeOf("number");
  });

  it("sorts a critical secret to the top, above medium then info", () => {
    const out = buildUnifiedFindings(
      [],
      [secret("medium", "med.ts"), secret("critical", "crit.ts")],
      [pattern("evil.ts")], // info tier
    );
    expect(out.map((f) => f.severity)).toEqual(["high", "medium", "info"]);
    expect(out[0].kind).toBe("secret");
    expect((out[0].data as SecretFinding).filePath).toBe("crit.ts");
  });

  it("never ranks a finding as NaN (the bug: 'critical' was unranked → NaN)", () => {
    const out = buildUnifiedFindings(
      [],
      [
        secret("critical", "a.ts"),
        secret("high", "b.ts"),
        secret("medium", "c.ts"),
      ],
      [pattern("d.ts")],
    );
    for (const f of out) {
      expect(Number.isNaN(SEVERITY_RANK[f.severity])).toBe(false);
    }
  });
});
