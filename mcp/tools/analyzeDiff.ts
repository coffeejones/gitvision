// `analyze_diff` MCP tool — function-level diff between two
// AnalysisSnapshots.
//
// Distinct from `compare_sessions`, which exists for the "overview"
// audience (top-10 added/removed by complexity + dup-group delta +
// coverage delta + file-level complexity shifts).
//
// `analyze_diff` is review-grade detail: it returns every changed
// function classified as added | removed | modified | unchanged, with
// per-function complexity delta, body-changed flag, and source-row
// pointers for linking back to the diff. Designed for the PR-comment
// use case where reviewer-friendly granularity matters more than a
// curated highlight reel.
//
// Both session ids must already be cached (call analyze_repo for the
// base ref first, then for the head ref — once analyze_repo supports
// a `ref` parameter that's the real-world workflow; until then both
// snapshots have to be of the same default branch and the tool will
// just report unchanged for everything).

import * as z from "zod/v4";
import { computeDiff } from "../../lib/codeAnalysis/diffAware";
import { getCached } from "../cache";

export const analyzeDiffInputSchema = {
  baseSessionId: z
    .string()
    .describe(
      "Session id of the base/target state — typically the main branch before the PR. Returned by an earlier analyze_repo call."
    ),
  headSessionId: z
    .string()
    .describe(
      "Session id of the head/PR state — typically the feature branch with proposed changes. Returned by an earlier analyze_repo call on the same repo."
    ),
  includeUnchanged: z
    .boolean()
    .optional()
    .describe(
      "When true, also include functions that didn't change in the response. Default false — output stays focused on added/removed/modified, which is what PR review cares about."
    ),
};

const InputSchema = z.object(analyzeDiffInputSchema);
type Input = z.infer<typeof InputSchema>;

export async function handleAnalyzeDiff(input: Input) {
  const baseSnap = await getCached(input.baseSessionId);
  if (!baseSnap) {
    return errorResult(
      `Base session '${input.baseSessionId}' not found or expired. Call analyze_repo on the base ref first to refresh the cache.`
    );
  }
  const headSnap = await getCached(input.headSessionId);
  if (!headSnap) {
    return errorResult(
      `Head session '${input.headSessionId}' not found or expired. Call analyze_repo on the head ref first.`
    );
  }
  if (!baseSnap.codeGraph || !headSnap.codeGraph) {
    return errorResult(
      `One or both sessions lacks a codeGraph${
        baseSnap.codeGraphSkipReason || headSnap.codeGraphSkipReason
          ? ` — ${baseSnap.codeGraphSkipReason ?? headSnap.codeGraphSkipReason}`
          : ""
      }. analyze_diff requires code-analysis output (JS/TS, Python, Go, Java, C#, PHP, or Ruby files) on both sides.`
    );
  }

  const diff = computeDiff(baseSnap.codeGraph, headSnap.codeGraph, {
    includeUnchanged: input.includeUnchanged ?? false,
  });

  return jsonResult({
    base: { sessionId: input.baseSessionId, fetchedAt: baseSnap.fetchedAt },
    head: { sessionId: input.headSessionId, fetchedAt: headSnap.fetchedAt },
    summary: diff.summary,
    changes: diff.changes,
  });
}

// ---------------- helpers ----------------

function jsonResult(payload: unknown) {
  return {
    content: [
      { type: "text" as const, text: JSON.stringify(payload, null, 2) },
    ],
  };
}

function errorResult(message: string) {
  return {
    content: [{ type: "text" as const, text: message }],
    isError: true,
  };
}
