// Session cache for the GitVision MCP server (v0.64 / C1.1).
//
// AI agents call repeatedly: analyze_repo → blast_radius → find_duplicates
// → blast_radius (different fn) → ... all on the same repo. We cache the
// AnalysisSnapshot in-memory keyed by a stable sessionId (a 12-char hash
// of the repo URL) so subsequent tool calls don't re-download + re-parse.
//
// C1.1 ships in-memory only — TTL 10 min, capped at 8 entries. C1.2 will
// add an on-disk layer at ~/.gitvision/cache/{sessionId}.json so the
// cache survives process restarts (Claude Code stops + starts the MCP
// server frequently during dev sessions).

import { createHash } from "node:crypto";
import type { AnalysisSnapshot } from "../lib/types";

interface CacheEntry {
  snapshot: AnalysisSnapshot;
  /** Epoch ms when the entry should be evicted on next access. */
  expiresAt: number;
}

const TTL_MS = 10 * 60 * 1000; // 10 minutes
const MAX_ENTRIES = 8;

/** sessionId from repoUrl: stable, opaque, doesn't leak the URL into
 *  the wire format. 12 chars of SHA-1 in hex is plenty unique for the
 *  scale we're at (one user's MCP session = handful of repos in flight). */
export function sessionIdFor(repoUrl: string): string {
  return createHash("sha1").update(repoUrl).digest("hex").slice(0, 12);
}

const cache = new Map<string, CacheEntry>();

/** Get a cached snapshot. Returns undefined when missing OR expired
 *  (the expired entry is evicted as a side-effect). */
export function getCached(sessionId: string): AnalysisSnapshot | undefined {
  const entry = cache.get(sessionId);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    cache.delete(sessionId);
    return undefined;
  }
  return entry.snapshot;
}

/** Store a snapshot under the given sessionId. Evicts the oldest entry
 *  when we hit MAX_ENTRIES — simple FIFO since AI agents tend to work
 *  on one or two repos at a time. */
export function setCached(sessionId: string, snapshot: AnalysisSnapshot): void {
  if (cache.size >= MAX_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey) cache.delete(oldestKey);
  }
  cache.set(sessionId, { snapshot, expiresAt: Date.now() + TTL_MS });
}

/** Convenience: combined "did we already analyze this URL recently?"
 *  lookup. Returns the snapshot if present, undefined if we need to
 *  download + parse fresh. */
export function lookup(repoUrl: string): {
  sessionId: string;
  snapshot: AnalysisSnapshot | undefined;
} {
  const sessionId = sessionIdFor(repoUrl);
  return { sessionId, snapshot: getCached(sessionId) };
}
