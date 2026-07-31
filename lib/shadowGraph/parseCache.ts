// Parse-layer cache for the Shadow-Graph patcher (Stage 0b). The production
// pipeline computes a per-file ParsedFile[] + plugin resolver contexts, then
// throws them away — keeping only the aggregate CodeGraph. The patcher needs
// that intermediate to re-parse a handful of touched files and rebuild the graph
// wholesale (10-50ms) instead of re-cloning + re-parsing the whole repo (seconds).
//
// CONTENT-ADDRESSED: the cache key is a strong digest of the exact analyzed file
// set (their content hashes). The same repo state always produces the same key,
// so the write can happen wherever the parse layer is available (any caller that
// analyzed a repo) without needing a session id, and identical states across
// sessions/refreshes/previews share one cache entry. A simulate looks the entry
// up by digesting the snapshot's already-persisted codeGraph.contentHashes.

import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { gzip, gunzip } from "node:zlib";
import { promisify } from "node:util";
import { atomicWriteBuffer } from "../atomicWrite";
import { djb2 } from "../codeAnalysis/fileUniverse";
import type { ParsedFile } from "../codeAnalysis/types";
import { encodeForJson, decodeFromJson } from "./serialize";

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

/** Cache-file format version. Bump on ANY change to the on-disk shape below. */
const SCHEMA_VERSION = 1;

/** The analyzer's semantic version. Bump whenever plugin parsing, buildCodeGraph,
 *  or the resolver logic changes in a way that alters the produced graph — a
 *  stale cache from an older analyzer must NOT be spliced against a newer engine.
 *  Mismatched entries are treated as absent (recompute path). */
// Bump whenever the SINK SET or the TAINT ENGINE changes: ParseLayer.files
// carries ParsedFile.sinks, so a stale entry serves the old, weaker findings
// back to a user who has already analysed a repo.
export const ANALYZER_VERSION = "7"; // 7: ~15 new sink rules + import aliases, await/request-method taint, receiver-position sinks (6: Python entry points + security sinks; 5: Ruby parenless calls)

const GC_MAX_BYTES = 500 * 1024 * 1024; // 500 MB default namespace budget

/** The intermediate the patcher needs — produced by analyzeDirectory, thrown
 *  away by production today. `pluginByFile` and `extras` are Maps (the codec
 *  preserves them); everything else is plain JSON. */
export interface ParseLayer {
  files: ParsedFile[];
  pluginByFile: Map<string, string>;
  /** FileIndex.extras — per-plugin resolver contexts (may contain nested Maps). */
  extras: Map<string, unknown>;
  contentHashes: Record<string, string>;
  truncated?: string;
  /** Scoping the analysis was run with (debug metadata — the digest already
   *  encodes scope via the file set, so this isn't load-bearing for correctness). */
  scope?: { subdir?: string; excludeFolders?: string[] };
}

export interface ParseCacheEntry extends ParseLayer {
  schemaVersion: number;
  analyzerVersion: string;
  universeDigest: string;
  repo?: string;
  ref?: string;
  createdAt: string;
}

/** Content-address the exact analyzed file set: a strong (sha256) digest over
 *  every file's path + content hash, order-independent (keys sorted). Collision-
 *  safe as a cache key (djb2 is fine for per-file change detection but too weak
 *  to key a content-addressed store). */
export function universeDigest(contentHashes: Record<string, string>): string {
  const keys = Object.keys(contentHashes).sort();
  const h = createHash("sha256");
  for (const k of keys) h.update(k + "\0" + contentHashes[k] + "\n");
  return h.digest("hex").slice(0, 32);
}

function parseCacheDir(): string {
  const dataDir =
    process.env.CODETRAWL_DATA_DIR ?? process.env.REPOBARON_DATA_DIR ?? path.join(process.cwd(), ".gitvision");
  return path.join(dataDir, "parsecache");
}

/** Only hex digests are valid keys — reject anything else before path.join
 *  (defence-in-depth against a crafted digest reaching the filesystem). */
function isValidDigest(digest: string): boolean {
  return /^[a-f0-9]{16,64}$/.test(digest);
}

function parseCachePath(digest: string): string {
  return path.join(parseCacheDir(), `${digest}.json.gz`);
}

/** Persist a parse layer. Key is derived from the layer's own contentHashes, so
 *  no session id is needed. Best-effort GC afterward. Returns the digest. */
export async function writeParseCache(
  layer: ParseLayer,
  meta?: { repo?: string; ref?: string }
): Promise<string> {
  const digest = universeDigest(layer.contentHashes);
  const entry: ParseCacheEntry = {
    schemaVersion: SCHEMA_VERSION,
    analyzerVersion: ANALYZER_VERSION,
    universeDigest: digest,
    repo: meta?.repo,
    ref: meta?.ref,
    createdAt: new Date().toISOString(),
    ...layer,
  };
  await fs.mkdir(parseCacheDir(), { recursive: true });
  // Yield before the synchronous serialize burst. encodeForJson deep-clones the
  // whole layer (up to DEFAULT_MAX_FILES ParsedFiles + the per-plugin resolver-
  // context Maps in `extras`) and JSON.stringify walks the clone again — bounded
  // main-thread work we keep OFF the current tick so it can't compound with a
  // caller's session-persistence latency or starve a concurrent simulate in the
  // same tick. gzip + disk below are already offloaded; the full serialize
  // offload to a worker is Stage 3 (gated on Railway contention measurement).
  await new Promise<void>((resolve) => setImmediate(resolve));
  const json = JSON.stringify(encodeForJson(entry));
  const gz = await gzipAsync(json, { level: 1 });
  await atomicWriteBuffer(parseCachePath(digest), gz);
  // Fire-and-forget GC — never block or fail the write on it.
  void gcParseCache().catch(() => {});
  return digest;
}

/** Read a parse layer by its content digest, or the digest of a snapshot's
 *  contentHashes. Returns null when absent, unreadable, schema/analyzer-version
 *  mismatched, or the base was truncated (fast path can't apply — plan §6.8). */
export async function readParseCache(
  digestOrHashes: string | Record<string, string>
): Promise<ParseCacheEntry | null> {
  const digest =
    typeof digestOrHashes === "string"
      ? digestOrHashes
      : universeDigest(digestOrHashes);
  if (!isValidDigest(digest)) return null;
  const file = parseCachePath(digest);
  let gz: Buffer;
  try {
    gz = await fs.readFile(file);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  let entry: ParseCacheEntry;
  try {
    const json = (await gunzipAsync(gz)).toString("utf-8");
    entry = decodeFromJson(JSON.parse(json)) as ParseCacheEntry;
  } catch {
    return null; // corrupt entry — treat as absent
  }
  if (
    entry.schemaVersion !== SCHEMA_VERSION ||
    entry.analyzerVersion !== ANALYZER_VERSION ||
    entry.truncated
  ) {
    return null;
  }
  // Read-touch so an actively-simulated entry isn't GC'd out from under a
  // session (mtime eviction is otherwise write-order, not use-order).
  const now = new Date();
  void fs.utimes(file, now, now).catch(() => {});
  return entry;
}

/** Refresh a cached entry's mtime WITHOUT reading it — keeps a still-in-use layer
 *  fresh against the oldest-mtime-first GC even when it's served from the warm
 *  cache (Stage 3b), which skips readParseCache's own read-touch. Without this a
 *  warm-served session's disk file freezes at populate-time mtime and becomes a
 *  GC victim, so a later warm eviction would spuriously report "layer-unavailable".
 *  Best-effort, fire-and-forget. */
export function touchParseCache(digest: string): void {
  if (!isValidDigest(digest)) return;
  const now = new Date();
  void fs.utimes(parseCachePath(digest), now, now).catch(() => {});
}

/** Enforce the namespace byte budget by evicting oldest-mtime entries first.
 *  Best-effort; safe to call concurrently (deletes are idempotent). */
export async function gcParseCache(maxBytes = GC_MAX_BYTES): Promise<void> {
  const dir = parseCacheDir();
  let names: string[];
  try {
    names = (await fs.readdir(dir)).filter((n) => n.endsWith(".json.gz"));
  } catch {
    return;
  }
  const stats: { file: string; size: number; mtime: number }[] = [];
  let total = 0;
  for (const n of names) {
    const file = path.join(dir, n);
    try {
      const st = await fs.stat(file);
      stats.push({ file, size: st.size, mtime: st.mtimeMs });
      total += st.size;
    } catch {
      /* raced deletion — ignore */
    }
  }
  if (total <= maxBytes) return;
  stats.sort((a, b) => a.mtime - b.mtime); // oldest first
  for (const s of stats) {
    if (total <= maxBytes) break;
    await fs.unlink(s.file).catch(() => {});
    total -= s.size;
  }
}
