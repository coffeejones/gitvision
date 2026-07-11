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
  | {
      ok: false;
      reason: "no-code-graph" | "layer-unavailable" | "too-large-to-simulate";
      message: string;
    };

export interface SimulateSessionOptions {
  /** Max cached-layer file count eligible for interactive simulation. Above it,
   *  the per-call whole-graph work (patch()'s full buildCodeGraph + baseGraphOf's
   *  second one + computeChangeBlast's refactor-safety/fan-in + the verdict
   *  layer's weak-suite + duplicate passes — all synchronous, O(repo)) is too
   *  heavy for the request thread. The runPatch byte caps bound only the re-parse
   *  of touched files, NOT this whole-repo rebuild, so we bound it by graph size
   *  here until the Stage 3 worker offload lands. Injectable for tests. */
  maxFiles?: number;
}

/** Default from the "sub-second" premise: a repo this large no longer rebuilds
 *  interactively anyway, so it gets a typed fallback instead of blocking the
 *  loop. Below the analysis file cap (5000); most real repos clear it. */
const DEFAULT_MAX_SIMULATE_FILES = 4000;

/** Simulate a proposed change against a session snapshot's cached parse layer.
 *  `snapshot` is structurally typed on just the field we key on, so a real
 *  AnalysisSnapshot and a test stub both fit. */
export async function runSimulateForSession(
  snapshot: { codeGraph?: { contentHashes?: Record<string, string> } },
  changes: FileChange[],
  limits?: PatchLimits,
  opts: SimulateSessionOptions = {},
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

  // Bound the per-call whole-repo rebuild by graph size (see maxFiles above).
  const maxFiles = opts.maxFiles ?? DEFAULT_MAX_SIMULATE_FILES;
  if (layer.files.length > maxFiles) {
    return {
      ok: false,
      reason: "too-large-to-simulate",
      message: `This repo (${layer.files.length} analyzed files) is above the interactive-simulation size limit (${maxFiles}). Simulation rebuilds the whole graph per call; that's not sub-second at this scale yet.`,
    };
  }

  // Grammars must be loaded before the patch re-parses the touched files.
  // plugin.load() is idempotent (loads once, then a no-op), so calling it per
  // request is cheap in a warm process and correct in a cold one.
  await Promise.all(ALL_PLUGINS.map((p) => p.load()));

  const result = await simulateChange(layer, changes, ALL_PLUGINS, limits);
  return { ok: true, result };
}
