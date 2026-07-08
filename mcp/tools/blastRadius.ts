// `blast_radius` MCP tool — answers "what breaks if I change this?"
//
// Two granularities sharing the same handler:
//   - File-level: pass `file` only → returns files that import/call into
//     it (incoming) and files it depends on (outgoing).
//   - Function-level: pass `file` + `fn` (and optionally `container`) →
//     returns functions that call into it / it calls into. Function-
//     level requires resolved call edges from the JS/TS, Python, Go, or
//     Java plugins.
//
// Counts are capped at 3 hops + 200 nodes per direction (same as the
// workspace UI). The truncation flag tells the agent when its
// reachable set is incomplete.

import * as z from "zod/v4";
import {
  computeBlastRadius,
  computeFunctionBlastRadius,
} from "../../lib/codeAnalysis/blastRadius";
import { deriveTestedFiles } from "../../lib/impact";
import { isTestFile } from "../../lib/codeAnalysis/testCoverage";
import { getCached } from "../cache";

/** The fields file- and function-level blast entries share. Function entries
 *  also carry name/containerType — preserved at runtime by the spread below and
 *  emitted in the JSON, just not reflected in this narrower type. */
interface BlastEntry {
  filePath: string;
  hop: number;
  crossModule: boolean;
}

/** Rank entries by RISK (untested → cross-module → nearest hop), then keep as
 *  many as fit in `charBudget`. Preserves the highest-risk nodes rather than
 *  the nearest ones, so a token-capped result still surfaces what actually
 *  matters. Tags each kept entry with `untested` so the agent sees the ranking
 *  rationale. Exported for unit testing. */
export function rankAndBudget(
  entries: BlastEntry[],
  tested: Set<string>,
  charBudget: number
): { shown: Array<BlastEntry & { untested: boolean }>; total: number } {
  const ranked = entries
    .map((e) => ({
      ...e,
      untested: !isTestFile(e.filePath) && !tested.has(e.filePath),
    }))
    .sort(
      (a, b) =>
        Number(b.untested) - Number(a.untested) ||
        Number(b.crossModule) - Number(a.crossModule) ||
        a.hop - b.hop ||
        a.filePath.localeCompare(b.filePath)
    );
  const shown: Array<BlastEntry & { untested: boolean }> = [];
  let used = 0;
  for (const e of ranked) {
    const cost = JSON.stringify(e).length + 2;
    // Always keep at least one so a tiny budget still returns the top risk.
    if (shown.length > 0 && used + cost > charBudget) break;
    shown.push(e);
    used += cost;
  }
  return { shown, total: entries.length };
}

export const blastRadiusInputSchema = {
  sessionId: z
    .string()
    .describe(
      "Session id returned by analyze_repo. The cached snapshot is reused for all tools."
    ),
  file: z
    .string()
    .describe(
      "Repo-relative path of the target file (e.g. 'src/auth/session.ts')."
    ),
  fn: z
    .string()
    .optional()
    .describe(
      "Optional function name. When provided, returns function-level blast (callers + callees) instead of file-level."
    ),
  container: z
    .string()
    .optional()
    .describe(
      "Optional class/struct name disambiguating same-named methods (e.g. 'UserService' for UserService.authenticate)."
    ),
  maxHops: z
    .number()
    .int()
    .min(1)
    .max(5)
    .optional()
    .describe("BFS depth cap. Default 3."),
  maxTokens: z
    .number()
    .int()
    .min(500)
    .max(50000)
    .optional()
    .describe(
      "Response token budget. When set, incoming/outgoing are ranked by RISK (untested → cross-module → nearest hop) and capped to fit an agent context window — the highest-risk nodes are kept, not just the nearest. Each entry is tagged `untested`, and a `budgeted` field reports what was trimmed. Omit for the full result."
    ),
};

const InputSchema = z.object(blastRadiusInputSchema);
type Input = z.infer<typeof InputSchema>;

export async function handleBlastRadius(input: Input) {
  const snapshot = await getCached(input.sessionId);
  if (!snapshot) {
    return errorResult(
      `Session '${input.sessionId}' not found or expired. Call analyze_repo again with the same repoUrl to refresh.`
    );
  }
  if (!snapshot.codeGraph) {
    return errorResult(
      `This session has no code graph${
        snapshot.codeGraphSkipReason
          ? ` — ${snapshot.codeGraphSkipReason}`
          : ""
      }. Blast radius requires code-analysis output (JS/TS, Python, Go, Java, C#, PHP, or Ruby files).`
    );
  }

  const opts = input.maxHops ? { maxHops: input.maxHops } : {};

  // Function-level branch needs (file, fn, optionally container); file-level
  // needs just file. Both produce the same result shape from here on.
  const result = input.fn
    ? computeFunctionBlastRadius(snapshot.codeGraph, input.file, input.fn, {
        ...opts,
        targetContainerType: input.container,
      })
    : computeBlastRadius(snapshot.codeGraph, input.file, opts);
  const kind = input.fn ? "function" : "file";

  const base = {
    kind,
    target: result.target,
    counts: {
      incoming: result.incoming.length,
      outgoing: result.outgoing.length,
      byHop: result.byHop,
      // Cross-module subset — entries in a different directory than the
      // target. A sharper risk signal than the raw count.
      crossModule: result.crossModuleCounts,
    },
    truncated: result.truncated,
  };

  // Token-budget mode: rank by risk + cap so the JSON fits an agent context.
  if (input.maxTokens) {
    const tested = deriveTestedFiles(snapshot.codeGraph);
    const charBudget = input.maxTokens * 3.5; // ~3.5 chars/token, conservative
    const inc = rankAndBudget(result.incoming, tested, charBudget * 0.55);
    const out = rankAndBudget(result.outgoing, tested, charBudget * 0.45);
    const trimmed =
      inc.shown.length < inc.total || out.shown.length < out.total;
    return jsonResult({
      ...base,
      incoming: inc.shown,
      outgoing: out.shown,
      budgeted: {
        maxTokens: input.maxTokens,
        ranking: "untested → cross-module → nearest hop",
        incomingShown: inc.shown.length,
        incomingTotal: inc.total,
        outgoingShown: out.shown.length,
        outgoingTotal: out.total,
        note: trimmed
          ? "Trimmed to fit maxTokens — the highest-risk nodes are kept. Raise maxTokens for more."
          : "The full result fit within maxTokens.",
      },
    });
  }

  return jsonResult({
    ...base,
    incoming: result.incoming,
    outgoing: result.outgoing,
  });
}

// ---------------- helpers ----------------

function jsonResult(payload: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(payload, null, 2),
      },
    ],
  };
}

function errorResult(message: string) {
  return {
    content: [{ type: "text" as const, text: message }],
    isError: true,
  };
}
