// The session-level simulate entry point both surfaces (MCP simulate_change, the
// web /simulate route) call. Turns "a session id + a proposed diff" into the
// blast verdict, or a typed fallback the caller renders as "re-analyze first".
//
// It recovers the parse layer written at analysis time (keyed by the snapshot's
// own contentHashes), so a simulate rebuilds the graph from the changed files
// only — never a fresh whole-repo analysis. When the layer is gone (evicted, or
// the session predates the patcher), it degrades explicitly rather than silently
// doing something slower or wrong.

import { ALL_PLUGINS } from "@/lib/codeAnalysis/plugins/all";
import { loadLayer } from "./persist";
import { simulateChange, type SimulateResult } from "./simulate";
import type { FileChange } from "./patch";
import type { PatchLimits } from "./runPatch";

export type SimulateSessionOutcome =
  | { ok: true; result: SimulateResult }
  | { ok: false; reason: "no-code-graph" | "layer-unavailable"; message: string };

/** Simulate a proposed change against a session snapshot's cached parse layer.
 *  `snapshot` is structurally typed on just the field we key on, so a real
 *  AnalysisSnapshot and a test stub both fit. */
export async function runSimulateForSession(
  snapshot: { codeGraph?: { contentHashes?: Record<string, string> } },
  changes: FileChange[],
  limits?: PatchLimits,
): Promise<SimulateSessionOutcome> {
  if (!snapshot.codeGraph) {
    return {
      ok: false,
      reason: "no-code-graph",
      message:
        "This snapshot has no code graph to simulate against — re-analyze the repo first.",
    };
  }

  const layer = await loadLayer(snapshot);
  if (!layer) {
    return {
      ok: false,
      reason: "layer-unavailable",
      message:
        "The parse layer for this snapshot has expired or wasn't cached (older sessions, or evicted under cache pressure). Refresh the session to rebuild it, then simulate.",
    };
  }

  // Grammars must be loaded before the patch re-parses the touched files.
  // plugin.load() is idempotent (loads once, then a no-op), so calling it per
  // request is cheap in a warm process and correct in a cold one.
  await Promise.all(ALL_PLUGINS.map((p) => p.load()));

  const result = await simulateChange(layer, changes, ALL_PLUGINS, limits);
  return { ok: true, result };
}
