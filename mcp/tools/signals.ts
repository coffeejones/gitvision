// `signals` MCP tool — full 17-signal health verdict.
//
// The deterministic signal layer that powers the workspace UI's
// Health-at-a-glance strip (and Claude's prose verdict on the
// Insights page). Wraps extractHealthSignals + summarizeHealth so
// agents get both the raw signal list and the dimension-level
// rollup in one call.
//
// We deliberately surface the dimension summary alongside raw
// signals: it lets agents quote "Code is critical" or "Activity is
// healthy" directly without having to re-classify 21 IDs themselves.

import * as z from "zod/v4";
import { extractHealthSignals } from "../../lib/signals";
import { summarizeHealth } from "../../lib/intelligence/healthSummary";
import { getCached } from "../cache";

export const signalsInputSchema = {
  sessionId: z
    .string()
    .describe("Session id returned by analyze_repo."),
  bucket: z
    .enum(["working", "needsWork", "questions", "all"])
    .optional()
    .describe(
      "Filter to one signal bucket. Default 'all'. 'needsWork' is the most actionable for refactor-focused agents."
    ),
};

const InputSchema = z.object(signalsInputSchema);
type Input = z.infer<typeof InputSchema>;

export async function handleSignals(input: Input) {
  const snapshot = await getCached(input.sessionId);
  if (!snapshot) {
    return errorResult(
      `Session '${input.sessionId}' not found or expired. Call analyze_repo with the same repoUrl to refresh.`
    );
  }

  const signals = extractHealthSignals(snapshot);
  const dimensions = summarizeHealth(snapshot);

  // Filter the signal buckets per the bucket arg. Default returns all
  // three buckets so an agent doing a comprehensive read gets one call.
  const wantAll = !input.bucket || input.bucket === "all";
  const filteredSignals = {
    working: wantAll || input.bucket === "working" ? signals.working : [],
    needsWork: wantAll || input.bucket === "needsWork" ? signals.needsWork : [],
    questions: wantAll || input.bucket === "questions" ? signals.questions : [],
  };

  return jsonResult({
    sessionId: input.sessionId,
    dimensions: dimensions.map((d) => ({
      id: d.id,
      label: d.label,
      status: d.status,
      detail: d.detail,
      signalCount: d.signalCount,
    })),
    signals: filteredSignals,
    totals: {
      working: signals.working.length,
      needsWork: signals.needsWork.length,
      questions: signals.questions.length,
    },
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
