// Session cache for the CodeTrawl MCP server (v0.64 / C1.1, on-disk
// layer added in v0.65 / C1.2).
//
// AI agents call repeatedly: analyze_repo → blast_radius →
// find_duplicates → blast_radius (different fn) → ... all on the
// same repo. We cache the AnalysisSnapshot keyed by a stable
// sessionId (12-char SHA-1 of the repo URL) so subsequent tool
// calls don't re-download + re-parse.
//
// Two-layer cache:
//   1. In-memory Map (hot path). 10-min TTL, 8-entry FIFO.
//   2. On-disk JSON at ~/.gitvision/cache/{sessionId}.json (warm
//      path). 24-hour TTL — survives MCP server restarts that
//      Claude Code does multiple times per dev session.
//
// Reads check in-memory first; on miss, fall back to disk. Writes
// fan out to both. On-disk eviction is lazy (read-time TTL check;
// expired files are deleted as a side effect). Disk failures never
// crash the lookup — we log and degrade to in-memory-only.

import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import type { AnalysisSnapshot } from "../lib/types";

interface CacheEntry {
  snapshot: AnalysisSnapshot;
  /** Epoch ms when the entry should be evicted on next access. */
  expiresAt: number;
}

const MEMORY_TTL_MS = 10 * 60 * 1000; // 10 min — refresh-window for active agent flows
const DISK_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours — survives restarts
const MAX_MEMORY_ENTRIES = 8;

const CACHE_DIR = path.join(homedir(), ".gitvision", "cache");

/** sessionId from repoUrl (+ optional ref): stable, opaque, doesn't
 *  leak the URL into the wire format. 12 chars of SHA-1 in hex is
 *  plenty unique for the scale we're at.
 *
 *  When `ref` is provided (v0.79+ for diff-aware workflows), it's
 *  folded into the hash so two analyses of the same repo at different
 *  refs (e.g. main vs feature-x) get distinct session ids and cache
 *  entries. Backward-compatible: passing no ref produces the same
 *  hash as before, so existing callers keep their cache. */
export function sessionIdFor(repoUrl: string, ref?: string | null): string {
  const key = ref ? `${repoUrl}@${ref}` : repoUrl;
  return createHash("sha1").update(key).digest("hex").slice(0, 12);
}

const memoryCache = new Map<string, CacheEntry>();

// ---------------- Memory layer ----------------

function getFromMemory(sessionId: string): AnalysisSnapshot | undefined {
  const entry = memoryCache.get(sessionId);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    memoryCache.delete(sessionId);
    return undefined;
  }
  return entry.snapshot;
}

function setInMemory(sessionId: string, snapshot: AnalysisSnapshot): void {
  if (memoryCache.size >= MAX_MEMORY_ENTRIES) {
    const oldestKey = memoryCache.keys().next().value;
    if (oldestKey) memoryCache.delete(oldestKey);
  }
  memoryCache.set(sessionId, {
    snapshot,
    expiresAt: Date.now() + MEMORY_TTL_MS,
  });
}

// ---------------- Disk layer ----------------

interface DiskEntry {
  snapshot: AnalysisSnapshot;
  cachedAt: string; // ISO timestamp
}

function diskPathFor(sessionId: string): string {
  return path.join(CACHE_DIR, `${sessionId}.json`);
}

async function ensureCacheDir(): Promise<void> {
  await fs.mkdir(CACHE_DIR, { recursive: true });
}

async function getFromDisk(
  sessionId: string
): Promise<AnalysisSnapshot | undefined> {
  const filePath = diskPathFor(sessionId);
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf-8");
  } catch {
    return undefined; // missing file = cache miss (normal)
  }
  let entry: DiskEntry;
  try {
    entry = JSON.parse(raw);
  } catch (err) {
    console.error(
      `codetrawl-mcp: corrupt cache file ${filePath}, evicting:`,
      err instanceof Error ? err.message : err
    );
    await fs.unlink(filePath).catch(() => {});
    return undefined;
  }
  const cachedAtMs = new Date(entry.cachedAt).getTime();
  if (Date.now() - cachedAtMs > DISK_TTL_MS) {
    // Expired — delete and miss
    await fs.unlink(filePath).catch(() => {});
    return undefined;
  }
  return entry.snapshot;
}

async function setOnDisk(
  sessionId: string,
  snapshot: AnalysisSnapshot
): Promise<void> {
  try {
    await ensureCacheDir();
    const entry: DiskEntry = {
      snapshot,
      cachedAt: new Date().toISOString(),
    };
    await fs.writeFile(
      diskPathFor(sessionId),
      JSON.stringify(entry),
      "utf-8"
    );
  } catch (err) {
    // Disk failures degrade to memory-only — never block the tool call.
    console.error(
      `codetrawl-mcp: failed to write disk cache for ${sessionId}:`,
      err instanceof Error ? err.message : err
    );
  }
}

// ---------------- Public API ----------------

/** Get a cached snapshot. Checks memory first, then disk. On a disk
 *  hit, hydrate the memory layer so subsequent calls in the same
 *  process are O(1). */
export async function getCached(
  sessionId: string
): Promise<AnalysisSnapshot | undefined> {
  const memHit = getFromMemory(sessionId);
  if (memHit) return memHit;

  const diskHit = await getFromDisk(sessionId);
  if (diskHit) {
    // Promote to memory so future calls in this process skip the disk.
    setInMemory(sessionId, diskHit);
    return diskHit;
  }
  return undefined;
}

/** Store a snapshot in both layers. Disk write is fire-and-forget
 *  if it fails — the tool call has already returned by then. */
export async function setCached(
  sessionId: string,
  snapshot: AnalysisSnapshot
): Promise<void> {
  setInMemory(sessionId, snapshot);
  await setOnDisk(sessionId, snapshot);
}

/** Convenience: combined "did we already analyze this URL (+ ref)
 *  recently?" lookup. Returns the sessionId either way; snapshot is
 *  undefined on miss. Pass `ref` to look up a non-default branch
 *  analysis (v0.79+). */
export async function lookup(
  repoUrl: string,
  ref?: string | null
): Promise<{
  sessionId: string;
  snapshot: AnalysisSnapshot | undefined;
}> {
  const sessionId = sessionIdFor(repoUrl, ref);
  return { sessionId, snapshot: await getCached(sessionId) };
}
