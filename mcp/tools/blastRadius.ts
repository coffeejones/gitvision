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
import { getCached } from "../cache";

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

  // Function-level branch — needs all three of (file, fn, optionally
  // container). Container disambiguates UserService.save vs OrderService.save.
  if (input.fn) {
    const result = computeFunctionBlastRadius(
      snapshot.codeGraph,
      input.file,
      input.fn,
      { ...opts, targetContainerType: input.container }
    );
    return jsonResult({
      kind: "function",
      target: result.target,
      incoming: result.incoming,
      outgoing: result.outgoing,
      counts: {
        incoming: result.incoming.length,
        outgoing: result.outgoing.length,
        byHop: result.byHop,
        // Cross-module subset — entries whose filePath sits in a different
        // directory than the target's. Sharper risk signal than raw count.
        crossModule: result.crossModuleCounts,
      },
      truncated: result.truncated,
    });
  }

  // File-level branch.
  const result = computeBlastRadius(snapshot.codeGraph, input.file, opts);
  return jsonResult({
    kind: "file",
    target: result.target,
    incoming: result.incoming,
    outgoing: result.outgoing,
    counts: {
      incoming: result.incoming.length,
      outgoing: result.outgoing.length,
      byHop: result.byHop,
      crossModule: result.crossModuleCounts,
    },
    truncated: result.truncated,
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
