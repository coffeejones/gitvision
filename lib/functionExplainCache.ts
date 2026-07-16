// In-memory read-through cache for per-function AI explanations.
//
// Why in-memory, not on the snapshot: a repo has hundreds of functions, and an
// explanation is a source-derived AI output. Persisting them all would bloat the
// session JSON (the very growth that filled the Railway volume once — see the
// dep on file-based storage) AND stretch the "we keep nothing" promise. So the
// explanation lives only here, exactly like the fetched source it's derived
// from: transient, never written to disk. A deploy resets it — acceptable; the
// worst case is one re-spend per function per deploy, and the aiBudget bounds
// that. Same trade-off the rate-limiter and aiBudget already make.
//
// Drift-proofing (the subtle part): the key must NOT use the branch ref. On the
// common "analyze the default branch" flow the analyzed ref is undefined and
// falls back to the branch name ("main"), which is stable across re-sweeps — so
// a refresh that changed the code would collide on the same key and serve a
// stale explanation. Instead we key on the ANALYZED file fingerprint (immutable
// per snapshot; changes the instant the file's bytes change) AND a digest of the
// exact signals fed to the model (fan-in etc. can move even when the file's own
// bytes don't). Any change to the source OR its grounding → new key → re-explain.

import { djb2 } from "./codeAnalysis/fileUniverse";
import type { FunctionExplanation, FunctionSignals } from "./functionExplain";

/** Cap the cache so a long-lived process can't grow unbounded. FIFO eviction
 *  (oldest key first) — good enough; the access pattern is "read a file, glance
 *  at a few functions", not a hot loop that would benefit from true LRU. */
const MAX_ENTRIES = 500;

const cache = new Map<string, FunctionExplanation>();

/** Build the cache key. Keyed on (session, path, line, analyzed-file hash,
 *  signals digest) — so it survives a re-sweep only when both the file's bytes
 *  and its grounding are byte-for-byte the same as when the entry was made. */
export function explainCacheKey(args: {
  sessionId: string;
  path: string;
  line: number;
  /** djb2 of the analyzed file (snapshot.codeGraph.contentHashes[path]). */
  fileHash: string;
  /** The exact signals handed to the model — hashed so a change to fan-in,
   *  churn, tier, etc. (which can move without the file's own bytes changing)
   *  also invalidates. */
  signals: FunctionSignals;
}): string {
  const digest = djb2(JSON.stringify(args.signals));
  return `${args.sessionId}:${args.path}:${args.line}:${args.fileHash}:${digest}`;
}

export function getCachedExplanation(key: string): FunctionExplanation | null {
  return cache.get(key) ?? null;
}

export function setCachedExplanation(key: string, value: FunctionExplanation): void {
  // Evict the oldest entry when full (Map preserves insertion order).
  if (cache.size >= MAX_ENTRIES && !cache.has(key)) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, value);
}

/** TEST-ONLY: clear the in-memory cache between cases. */
export function _resetExplainCacheForTest(): void {
  cache.clear();
}
