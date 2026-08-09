// `find_duplicates` MCP tool — surfaces structurally identical
// functions across the codebase via FNV-1a AST hashes.
//
// This is the highest-leverage refactor signal we expose: when the
// same function body appears in 3+ files (modulo identifier
// renaming), there's almost certainly a missing helper. Agents can
// use this to propose specific extraction PRs.

import * as z from "zod/v4";
import {
  countDuplicateGroups,
  topDuplicateGroups,
} from "../../lib/codeAnalysis/duplicates";
import { getCached } from "../cache";

export const findDuplicatesInputSchema = {
  sessionId: z
    .string()
    .describe("Session id returned by analyze_repo."),
  minComplexity: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe(
      "Skip functions below this McCabe complexity. Default 5 — keeps trivial getters/one-liners out of the result."
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(50)
    .optional()
    .describe("Cap the result list. Default 15."),
};

const InputSchema = z.object(findDuplicatesInputSchema);
type Input = z.infer<typeof InputSchema>;

export async function handleFindDuplicates(input: Input) {
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
      }. Duplicate detection requires AST-parsed source.`
    );
  }

  const groups = topDuplicateGroups(snapshot.codeGraph, {
    minComplexity: input.minComplexity,
    limit: input.limit,
  });
  // The page and the total, separately. `groupCount: groups.length` handed the
  // agent the page size — 15 on a repo with 37 — and its only clue that the
  // list had been cut was that the number happened to equal the default limit.
  const totalGroups = countDuplicateGroups(snapshot.codeGraph, {
    minComplexity: input.minComplexity,
  });

  return jsonResult({
    sessionId: input.sessionId,
    totalGroups,
    returnedGroups: groups.length,
    truncated: groups.length < totalGroups,
    // Drop the bodyHash from each member — it's an internal detail
    // that would just bloat the agent's context window.
    groups: groups.map((g) => ({
      memberCount: g.members.length,
      maxComplexity: g.maxComplexity,
      members: g.members.map((m) => ({
        filePath: m.filePath,
        name: m.name,
        containerType: m.containerType,
        startRow: m.startRow,
        endRow: m.endRow,
        complexity: m.complexity,
      })),
    })),
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
