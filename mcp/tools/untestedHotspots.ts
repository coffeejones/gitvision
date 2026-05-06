// `untested_hotspots` MCP tool — production functions with no direct
// test caller, sorted by complexity desc.
//
// This is the most actionable test-debt signal: an agent can pick the
// top hotspot, write a test, repeat. We expose totals (whole-repo
// coverage stats) alongside the list so an agent can also reason
// about overall coverage without a separate call.

import * as z from "zod/v4";
import { computeTestCoverage } from "../../lib/codeAnalysis/testCoverage";
import { getCached } from "../cache";

export const untestedHotspotsInputSchema = {
  sessionId: z
    .string()
    .describe("Session id returned by analyze_repo."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(50)
    .optional()
    .describe(
      "Cap the hotspot list. Default 10 — usually enough to scope a single refactor sprint."
    ),
};

const InputSchema = z.object(untestedHotspotsInputSchema);
type Input = z.infer<typeof InputSchema>;

export async function handleUntestedHotspots(input: Input) {
  const snapshot = await getCached(input.sessionId);
  if (!snapshot) {
    return errorResult(
      `Session '${input.sessionId}' not found or expired. Call analyze_repo with the same repoUrl to refresh.`
    );
  }
  if (!snapshot.codeGraph) {
    return errorResult(
      `This session has no code graph${
        snapshot.codeGraphSkipReason ? ` — ${snapshot.codeGraphSkipReason}` : ""
      }. Coverage analysis requires AST-parsed source.`
    );
  }

  const coverage = computeTestCoverage(snapshot.codeGraph, {
    untestedHotspotsLimit: input.limit,
  });

  // Compute coverage percentage so agents don't have to do the math.
  const coveragePct =
    coverage.totals.prodFunctions > 0
      ? Math.round(
          (coverage.totals.testedProdFunctions / coverage.totals.prodFunctions) *
            100
        )
      : 0;

  return jsonResult({
    sessionId: input.sessionId,
    totals: {
      ...coverage.totals,
      coveragePct,
    },
    hotspots: coverage.untestedHotspots,
    note:
      coverage.totals.testFiles === 0
        ? "No test files detected — every prod function reads as untested. The hotspot list reflects raw complexity, not coverage gaps."
        : undefined,
  });
}

// ---------------- helpers ----------------

function jsonResult(payload: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
  };
}

function errorResult(message: string) {
  return {
    content: [{ type: "text" as const, text: message }],
    isError: true,
  };
}
