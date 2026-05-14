// `review_changes` MCP tool — function-level diff between two sessions
// PLUS prioritized verification suggestions from the rules engine. The
// "what should a reviewer actually do?" companion to `analyze_diff`'s
// "what changed?".
//
// Natural pairing:
//   analyze_diff(base, head)    → raw ChangedFunction[] (for displays,
//                                  audits, eval scoring)
//   review_changes(base, head)  → prioritized human-friendly suggestions
//                                  (for PR-bot output, reviewer hints)
//
// Both call the same underlying computeDiff(); review_changes adds the
// rules-engine pass on top and caps output at maxResults (default 3 —
// PR-comment-grade brevity).

import * as z from "zod/v4";
import { computeDiff } from "../../lib/codeAnalysis/diffAware";
import { evaluateVerificationRules } from "../../lib/codeAnalysis/verificationRules";
import { getCached } from "../cache";

export const reviewChangesInputSchema = {
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
  maxResults: z
    .number()
    .int()
    .min(1)
    .max(20)
    .optional()
    .describe(
      "Cap on returned suggestions. Default 3 — that's the PR-comment-grade budget past which reviewers tune out. Set higher for deep-dive views."
    ),
};

const InputSchema = z.object(reviewChangesInputSchema);
type Input = z.infer<typeof InputSchema>;

export async function handleReviewChanges(input: Input) {
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
      }. review_changes requires code-analysis output (JS/TS, Python, Go, Java, C#, PHP, or Ruby files) on both sides.`
    );
  }

  // Compute the diff once, feed it into the rules engine. We don't
  // include the full changes[] array in the response — Claude can call
  // analyze_diff for that when it needs raw data. We return only the
  // summary + suggestions, which is what a PR-bot UI actually consumes.
  const diff = computeDiff(baseSnap.codeGraph, headSnap.codeGraph);
  const suggestions = evaluateVerificationRules(
    { diff },
    { maxResults: input.maxResults ?? 3 }
  );

  return jsonResult({
    base: { sessionId: input.baseSessionId, fetchedAt: baseSnap.fetchedAt },
    head: { sessionId: input.headSessionId, fetchedAt: headSnap.fetchedAt },
    summary: diff.summary,
    suggestions,
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
