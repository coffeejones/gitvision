// The app-integration seam for the Shadow-Graph parse cache (Stage 1d). Keeps
// parseCache.ts pure I/O; this module is where the analysis pipeline plugs in.
//
// Two directions:
//   - write: `parseLayerWriter(meta)` returns the `onParseLayer` callback the
//     session-creating callers (jobs create/refresh, watch re-sweep) hand to
//     analyzeRepo, so every fresh snapshot leaves a reusable parse layer behind.
//   - read: `loadLayer(snapshot)` recovers the layer that produced a snapshot's
//     code graph — keyed by the snapshot's own contentHashes, which is exactly
//     the analyzed file set the layer was written under. The read side both
//     simulate surfaces (MCP simulate_change, the web /simulate route) call.

import {
  writeParseCache,
  readParseCache,
  touchParseCache,
  universeDigest,
  type ParseLayer,
  type ParseCacheEntry,
} from "./parseCache";
import { getWarmLayer, putWarmLayer } from "./layerCache";

/** Bind repo/ref metadata and return the writer callback for analyzeRepo's
 *  `onParseLayer`. writeParseCache keys on the layer's own contentHashes, so the
 *  meta is debug-only (recorded on the entry, not part of the address). */
export function parseLayerWriter(meta: {
  repo?: string;
  ref?: string;
}): (layer: ParseLayer) => Promise<string> {
  return (layer) => writeParseCache(layer, meta);
}

/** Load the parse layer that produced a snapshot's code graph, if still cached.
 *  Structurally typed on just `codeGraph.contentHashes` so a real
 *  AnalysisSnapshot (or a test stub) both fit. Returns null when the snapshot
 *  carries no code graph / no hashes, or the layer was evicted or written by a
 *  now-incompatible analyzer version — every caller must handle that by falling
 *  back to a full re-analysis. */
export async function loadLayer(snapshot: {
  codeGraph?: { contentHashes?: Record<string, string> };
}): Promise<ParseCacheEntry | null> {
  const hashes = snapshot.codeGraph?.contentHashes;
  if (!hashes || Object.keys(hashes).length === 0) return null;

  // Warm cache first (Stage 3b) — skip the disk read + gunzip + Map/Set decode on
  // repeat simulates. Keyed by the same content digest readParseCache derives.
  const digest = universeDigest(hashes);
  const warm = getWarmLayer(digest);
  if (warm) {
    // Refresh the disk mtime the warm hit would otherwise skip, so GC keeps the
    // fallback file alive while the session is still being simulated (3b review).
    touchParseCache(digest);
    return warm;
  }

  const entry = await readParseCache(digest);
  if (entry) putWarmLayer(digest, entry);
  return entry;
}
