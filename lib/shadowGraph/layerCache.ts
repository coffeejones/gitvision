// Warm parse-layer cache (Stage 3b).
//
// loadLayer otherwise re-reads + gunzips + JSON.parses + Map/Set-decodes the
// WHOLE parse layer from disk on every simulate — synchronous work that scales
// with repo size, repeated for every candidate diff on the same session. This is
// a small in-memory LRU of decoded layers keyed by content digest, so repeat
// simulates on a session skip all of that.
//
// SAFE TO SHARE ONE INSTANCE across simulates because patch() treats the layer as
// read-only: it copies pluginByFile/contentHashes and builds a fresh patched file
// set + new ParsedFile objects, and resolvers only READ the persisted extras
// (verified in stubIndex.ts's header). The reuse invariant is pinned by a test
// (simulate twice on the same layer → identical). Content-addressed keys mean a
// refreshed session gets a new digest → a clean miss, so no explicit
// invalidation is ever needed; stale entries just age out.

import type { ParseCacheEntry } from "./parseCache";

/** Max decoded layers held at once. */
const MAX_ENTRIES = 8;
/** Total parsed-file budget across all cached layers — a memory proxy (a layer's
 *  file count dominates its decoded size). Evict LRU until under it. */
const MAX_TOTAL_FILES = 15_000;

// Insertion order === recency: a get() re-inserts to move an entry to newest.
const cache = new Map<string, ParseCacheEntry>();
let totalFiles = 0;

/** Warm hit for a digest, or undefined. Touches recency on a hit. */
export function getWarmLayer(digest: string): ParseCacheEntry | undefined {
  const hit = cache.get(digest);
  if (hit) {
    cache.delete(digest);
    cache.set(digest, hit); // move to newest
  }
  return hit;
}

/** Cache a decoded layer, evicting least-recently-used entries to stay within
 *  the entry + file-count budgets. Pathologically large layers (above the whole
 *  budget) are skipped — they can't be simulated past the size cap anyway. */
export function putWarmLayer(digest: string, entry: ParseCacheEntry): void {
  if (cache.has(digest)) return;
  const files = entry.files.length;
  if (files > MAX_TOTAL_FILES) return;

  cache.set(digest, entry);
  totalFiles += files;

  while (cache.size > MAX_ENTRIES || totalFiles > MAX_TOTAL_FILES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined || oldest === digest) break; // never evict what we just added
    totalFiles -= cache.get(oldest)!.files.length;
    cache.delete(oldest);
  }
}

/** Test hook — reset the cache between cases. */
export function clearWarmLayers(): void {
  cache.clear();
  totalFiles = 0;
}
