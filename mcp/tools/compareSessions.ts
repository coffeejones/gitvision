// `compare_sessions` MCP tool — diff two AnalysisSnapshots for AI
// agents that want to know "what changed structurally between these
// two analyses?".
//
// Use case: agent analyzes a repo, suggests a refactor, the user
// applies it, agent re-analyzes, then calls compare_sessions to
// verify the refactor actually moved the needle (dup-groups
// dissolved? coverage went up? complexity dropped on the touched
// file?).
//
// Both session ids must already exist in the cache (via prior
// analyze_repo calls). We don't fetch fresh — the whole point is to
// compare two specific previously-analyzed states.

import * as z from "zod/v4";
import { structuralDiff } from "../../lib/intelligence/structuralDiff";
import { getCached } from "../cache";

export const compareSessionsInputSchema = {
  fromSessionId: z
    .string()
    .describe(
      "Earlier session id — usually returned by an analyze_repo call before some change was made."
    ),
  toSessionId: z
    .string()
    .describe(
      "Later session id — usually returned by analyze_repo on the same repo after the change."
    ),
};

const InputSchema = z.object(compareSessionsInputSchema);
type Input = z.infer<typeof InputSchema>;

export async function handleCompareSessions(input: Input) {
  const fromSnap = await getCached(input.fromSessionId);
  if (!fromSnap) {
    return errorResult(
      `Earlier session '${input.fromSessionId}' not found or expired. Both sides must be analyzed first.`
    );
  }
  const toSnap = await getCached(input.toSessionId);
  if (!toSnap) {
    return errorResult(
      `Later session '${input.toSessionId}' not found or expired. Both sides must be analyzed first.`
    );
  }

  const diff = structuralDiff(fromSnap, toSnap);
  return jsonResult({
    from: { sessionId: input.fromSessionId, fetchedAt: diff.fromFetchedAt },
    to: { sessionId: input.toSessionId, fetchedAt: diff.toFetchedAt },
    summary: {
      functionsAdded: diff.totalAdded,
      functionsRemoved: diff.totalRemoved,
      duplicateGroupsAdded: diff.duplicateGroupsAdded,
      duplicateGroupsDissolved: diff.duplicateGroupsDissolved,
      coverageDelta: diff.coverageDelta,
    },
    functionsAdded: diff.functionsAdded,
    functionsRemoved: diff.functionsRemoved,
    complexityWorsened: diff.complexityWorsened,
    complexityImproved: diff.complexityImproved,
    degraded: diff.degraded,
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
