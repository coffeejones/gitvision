// Unit coverage for the simulate_change payload shaping (the pure part — the
// cache-coupled handler is exercised via the server error-path test + the
// runSimulateForSession suite).

import { describe, it, expect } from "vitest";
import { buildSimulatePayload } from "../tools/simulateChange";
import type { SimulateResult } from "../../lib/shadowGraph/simulate";
import type { ChangeBlastReport } from "../../lib/changeBlast/types";

const report = {
  hasGraphs: true,
  changedFiles: [
    {
      file: "core.ts",
      kind: "modified",
      tier: "load-bearing",
      dependents: 12,
      untestedDependents: 12,
      complexity: 3,
      isTest: false,
      testsToRun: [],
    },
  ],
  wallsTouched: ["core.ts"],
  loadBearingTouched: ["core.ts"],
  combinedDependents: 12,
  functionsAdded: 0,
  functionsRemoved: 0,
  testFilesChanged: 0,
  testsToRun: [],
  mappedTestsUpdated: 0,
  verdict: "high-risk",
  headline: "core.ts is load-bearing; 12 files depend on it.",
} as unknown as ChangeBlastReport;

describe("buildSimulatePayload", () => {
  it("shapes a patched result into a verdict + required actions + blast", () => {
    const result: SimulateResult = {
      mode: "patched",
      report,
      requiredActions: [
        {
          kind: "load-bearing-touched",
          severity: "high",
          detail: "Touches 1 load-bearing wall.",
          evidence: { files: ["core.ts"], numbers: { walls: 1, dependentsReached: 12 } },
        },
        {
          kind: "no-guarding-tests",
          severity: "high",
          detail: "No test guards it.",
          evidence: {},
        },
      ],
      approximations: [],
    };

    const payload = buildSimulatePayload(result) as Record<string, unknown>;
    expect(payload.simulated).toBe(true);
    expect(payload.mode).toBe("patched");
    expect(payload.verdict).toBe("high-risk");
    expect(payload.headline).toMatch(/load-bearing/);
    const kinds = (payload.requiredActions as Array<{ kind: string }>).map((a) => a.kind);
    expect(kinds).toEqual(["load-bearing-touched", "no-guarding-tests"]);
    const blast = payload.blast as Record<string, unknown>;
    expect(blast.loadBearingTouched).toEqual(["core.ts"]);
    expect(blast.combinedDependents).toBe(12);
    expect((payload.changedFiles as unknown[]).length).toBe(1);
  });

  it("shapes a non-patched mode as an explicit re-analyze signal", () => {
    const result: SimulateResult = {
      mode: "needs-full-analysis",
      requiredActions: [],
      approximations: [],
    };

    const payload = buildSimulatePayload(result) as Record<string, unknown>;
    expect(payload.simulated).toBe(false);
    expect(payload.mode).toBe("needs-full-analysis");
    expect(typeof payload.reason).toBe("string");
    expect((payload.reason as string).length).toBeGreaterThan(0);
    expect(payload.nextStep).toMatch(/analyze_repo/);
    // No blast/verdict leak on the non-patched path.
    expect(payload.verdict).toBeUndefined();
  });

  it("surfaces a base-mismatch's drifted files", () => {
    const result: SimulateResult = {
      mode: "base-mismatch",
      requiredActions: [],
      approximations: [],
      baseMismatch: ["core.ts", "dep0.ts"],
    };

    const payload = buildSimulatePayload(result) as Record<string, unknown>;
    expect(payload.simulated).toBe(false);
    expect(payload.mode).toBe("base-mismatch");
    expect(payload.baseMismatch).toEqual(["core.ts", "dep0.ts"]);
  });
});
