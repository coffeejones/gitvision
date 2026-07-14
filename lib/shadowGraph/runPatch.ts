// The async seam in front of the pure patch() engine (Stage 1b). Two jobs:
//
// 1. DoS pre-gate. patch()/buildCodeGraph run SYNCHRONOUSLY on the Node event
//    loop, and tree-sitter parsing can't be interrupted mid-parse. A large
//    (but not minified — those are dropped by the universe filter, matching full
//    analysis) source file can block for hundreds of ms. So we cap per-file +
//    cumulative touched bytes + change count BEFORE any parsing, returning
//    "too-large" instead of blocking.
//
//    SCOPE: these caps bound only the RE-PARSE of the touched files. They do NOT
//    bound the dominant per-call cost — patch() then rebuilds the WHOLE graph
//    (buildCodeGraph over every file), and the verdict layer diffs two full
//    graphs (refactor-safety + fan-in + weak-suite + duplicate passes, x2). That
//    cost scales with the analyzed repo size, not the touched-byte payload, so it
//    is bounded separately: runSimulateForSession refuses layers above a file-count
//    limit, and Stage 3 moves the whole compute to a worker. The byte figures
//    below therefore describe the re-parse burst alone, not the full request.
//
// 2. A worker-ready boundary. This is async so a worker_thread pool can be
//    dropped in behind it — WITHOUT changing any caller — IF Stage 3's on-Railway
//    contention matrix shows the bounded-synchronous path misses its p95 budget.
//    Building the (Next.js-fragile) worker infra now would be speculative; the
//    review's own guidance is to bound + measure first, then add the worker only
//    if the data demands it.

import type { CodeAnalysisPlugin } from "../codeAnalysis/types";
import { patch, type FileChange, type PatchResult } from "./patch";
import type { ParseLayer } from "./parseCache";

export interface PatchLimits {
  /** Max UTF-8 bytes for any single touched file's new content. */
  maxFileBytes?: number;
  /** Max cumulative UTF-8 bytes across all touched files. */
  maxTotalBytes?: number;
  /** Max number of changes in one request. */
  maxEntries?: number;
}

const DEFAULT_LIMITS: Required<PatchLimits> = {
  maxFileBytes: 256 * 1024, // 256 KB — a normal source file; a dense 256 KB blob RE-PARSES in ~180ms
  maxTotalBytes: 512 * 1024, // 512 KB cumulative — bounds the re-parse burst (~350ms), not the whole-repo rebuild
  maxEntries: 200,
};

export async function runPatch(
  layer: ParseLayer,
  changes: FileChange[],
  plugins: CodeAnalysisPlugin[],
  limits: PatchLimits = {},
): Promise<PatchResult> {
  const lim = { ...DEFAULT_LIMITS, ...limits };

  if (changes.length > lim.maxEntries) {
    return {
      mode: "too-large",
      reason: `too many changes (${changes.length} > ${lim.maxEntries})`,
      approximations: [],
    };
  }

  let total = 0;
  for (const c of changes) {
    if (c.newContent == null) continue; // deletes cost nothing to parse
    const bytes = Buffer.byteLength(c.newContent, "utf-8");
    if (bytes > lim.maxFileBytes) {
      return {
        mode: "too-large",
        reason: `${c.path} is ${bytes} bytes (> ${lim.maxFileBytes}); re-analyze the repo to simulate it`,
        approximations: [],
      };
    }
    total += bytes;
  }
  if (total > lim.maxTotalBytes) {
    return {
      mode: "too-large",
      reason: `cumulative touched bytes ${total} > ${lim.maxTotalBytes}`,
      approximations: [],
    };
  }

  // Bounded synchronous compute (worker slot lives here in a future hardening).
  return patch(layer, changes, plugins);
}

export type { PatchResult, FileChange };
