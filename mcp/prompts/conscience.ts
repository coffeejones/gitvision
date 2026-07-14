// The Conscience loop, as a first-class MCP prompt.
//
// simulate_change gives an agent the deterministic verdict; this prompt is the
// reusable INSTRUCTION that turns it into a loop the agent actually follows —
// propose → simulate → resolve the blocking gate → re-simulate → done. Any agent
// harness can invoke it before declaring a change finished.

import * as z from "zod/v4";

export const CONSCIENCE_PROMPT_NAME = "conscience";

export const conscienceArgsSchema = {
  sessionId: z
    .string()
    .optional()
    .describe(
      "The analyze_repo session id for the repo you're changing, if you already have one.",
    ),
};

/** The conscience-loop instruction text. Pure, so it's unit-testable. */
export function conscienceMessage(sessionId?: string): string {
  const sess = sessionId ? ` (session \`${sessionId}\`)` : "";
  return [
    "Before you present your code change as done, run it past the CodeTrawl conscience — a deterministic gate, not a suggestion:",
    "",
    `1. Ensure the repo is analyzed${sess}. Call \`analyze_repo\` first if you don't have a session id.`,
    "2. Call `simulate_change` with your FULL proposed diff — every changed, added, or deleted file as a whole-file entry in `changes`.",
    "3. Read `gate` in the result:",
    "   - `gate.pass: true` → clear to proceed. Still weigh `gate.advisory` (e.g. new duplication, guarding tests to keep in sync).",
    "   - `gate.pass: false` → you are NOT done. Every item in `gate.blocking` means the change ships a regression nothing would catch: load-bearing code with no guarding test, a hollow test that asserts nothing meaningful, or a guarding test the change breaks.",
    "4. For each blocker: FIX it (add or repair the guarding test; remove the hollow assertion) and re-run `simulate_change` — or give an explicit, specific justification for leaving it. Repeat until `gate.pass` is true or every remaining blocker is justified.",
    "",
    "The verdict is computed from the real import + call graph and cited to concrete files. Treat `gate.pass: false` as a stop, not a warning.",
  ].join("\n");
}

/** MCP prompt handler — wraps the message text into a GetPromptResult. */
export function conscienceHandler(args: { sessionId?: string }) {
  return {
    messages: [
      {
        role: "user" as const,
        content: {
          type: "text" as const,
          text: conscienceMessage(args.sessionId),
        },
      },
    ],
  };
}
