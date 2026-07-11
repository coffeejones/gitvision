// `simulate_change` MCP tool — the agent conscience.
//
// Before an AI agent commits a diff, it can ask "what does this break?" and get
// a DETERMINISTIC answer: the change is spliced into the session's cached parse
// layer, the code graph is rebuilt (byte-identical to a full re-analysis for
// JS/TS), and the result is diffed against the base. The tool returns a blast
// verdict plus a machine-readable `requiredActions` list — "you touched a
// load-bearing wall with no guarding test", "this new test asserts nothing",
// "this now duplicates existing code" — grounded in computed deltas, never a
// judgment the graph can't back.
//
// Sub-second because only the changed files are re-parsed. Call analyze_repo
// first for the session id; then simulate as many candidate diffs as you like
// against that one snapshot.

import * as z from "zod/v4";
import { getCached } from "../cache";
import { runSimulateForSession } from "../../lib/shadowGraph/simulateSession";
import type { FileChange } from "../../lib/shadowGraph/patch";
import type { SimulateResult } from "../../lib/shadowGraph/simulate";

export const simulateChangeInputSchema = {
  sessionId: z
    .string()
    .describe(
      "Session id returned by analyze_repo. The cached snapshot + its parse layer are reused, so simulation is sub-second."
    ),
  changes: z
    .array(
      z.object({
        path: z
          .string()
          .describe("Repo-relative path of the file (e.g. 'src/auth/session.ts')."),
        newContent: z
          .string()
          .nullable()
          .describe(
            "The file's proposed full new contents, or null to simulate DELETING it. For an added file, pass its contents with a path not already in the repo."
          ),
      })
    )
    .min(1)
    .max(200)
    .describe(
      "The proposed diff as a set of whole-file changes (edit, add, or delete). Whole-file, not a patch/hunk."
    ),
};

const InputSchema = z.object(simulateChangeInputSchema);
type Input = z.infer<typeof InputSchema>;

export async function handleSimulateChange(input: Input) {
  const snapshot = await getCached(input.sessionId);
  if (!snapshot) {
    return errorResult(
      `Session '${input.sessionId}' not found or expired. Call analyze_repo again with the same repoUrl to refresh.`
    );
  }

  const changes: FileChange[] = input.changes.map((c) => ({
    path: c.path,
    newContent: c.newContent,
  }));

  const out = await runSimulateForSession(snapshot, changes);
  if (!out.ok) {
    // no-code-graph / layer-unavailable — an explicit "can't simulate, re-analyze"
    // signal, not a crash. Return it as an error so the agent redirects.
    return errorResult(out.message);
  }

  return jsonResult(buildSimulatePayload(out.result));
}

/** Shape a SimulateResult into the agent-facing payload. Pure (no cache / IO) so
 *  it's unit-testable on its own — the patched branch surfaces the verdict +
 *  required actions + blast; a non-patched mode tells the agent to re-analyze
 *  instead of trusting a partial answer. Exported for tests. */
export function buildSimulatePayload(r: SimulateResult): Record<string, unknown> {
  if (r.mode !== "patched" || !r.report) {
    // The change can't take the golden fast path (a config/manifest edit, an
    // oversized payload, or a base that drifted).
    return {
      simulated: false,
      mode: r.mode,
      reason: r.reason ?? modeReason(r.mode),
      ...(r.baseMismatch ? { baseMismatch: r.baseMismatch } : {}),
      approximations: r.approximations,
      nextStep:
        "Re-run analyze_repo on the changed ref to get an exact result for this kind of change.",
    };
  }

  const report = r.report;
  return {
    simulated: true,
    mode: r.mode,
    verdict: report.verdict, // clear | review | high-risk
    headline: report.headline,
    // The actionable conscience — what to do before merging. The star of the result.
    requiredActions: r.requiredActions,
    blast: {
      wallsTouched: report.wallsTouched,
      loadBearingTouched: report.loadBearingTouched,
      combinedDependents: report.combinedDependents,
      functionsAdded: report.functionsAdded,
      functionsRemoved: report.functionsRemoved,
      testFilesChanged: report.testFilesChanged,
      testsToRun: report.testsToRun,
      mappedTestsUpdated: report.mappedTestsUpdated,
    },
    // Every changed file, risk-ranked (non-test → tier → reach).
    changedFiles: report.changedFiles,
    // The dependent files the change reaches — WHICH files to check, nearest +
    // untested first. The concrete "what breaks" list behind the counts.
    affectedFiles: r.affectedFiles,
    // Non-JS/TS files carry declared approximations (frozen cross-file edges);
    // empty when the whole diff was JS/TS-precise.
    approximations: r.approximations,
  };
}

// ---------------- helpers ----------------

function modeReason(mode: string): string {
  switch (mode) {
    case "needs-full-analysis":
      return "This change touches a config/manifest file that can reshape resolution repo-wide, so it can't be fast-path simulated.";
    case "too-large":
      return "The proposed change exceeds the per-simulate size budget.";
    case "base-mismatch":
      return "The cached base no longer matches the files being changed (the repo moved on).";
    default:
      return "This change can't be simulated on the fast path.";
  }
}

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
