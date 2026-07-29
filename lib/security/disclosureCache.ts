// In-memory read-through cache for disclosure reports.
//
// Same trade-off as functionExplainCache: a report is an AI-derived output of a
// finding, so it lives here only — never written to the session JSON (which
// once filled the Railway volume) and never stretching the "we keep nothing"
// promise. A deploy resets it; the worst case is one re-spend per finding per
// deploy, which the aiBudget bounds.
//
// Keyed on (session, findingKey, ownership, analyzed-file hash). The file hash
// is what makes it drift-proof: a re-sweep that changes the sink's file mints a
// new key, so a stale report can never be served for edited code. Ownership is
// in the key because the two calibrations are genuinely different reports.

import type { DisclosureReport, FindingOwnership } from "./disclosure";

const MAX_ENTRIES = 500;
const cache = new Map<string, DisclosureReport>();

export function disclosureCacheKey(args: {
  sessionId: string;
  findingKey: string;
  ownership: FindingOwnership;
  /** djb2 of the analyzed file the sink lives in (contentHashes[filePath]). */
  fileHash: string;
}): string {
  return `${args.sessionId}:${args.findingKey}:${args.ownership}:${args.fileHash}`;
}

export function getCachedDisclosure(key: string): DisclosureReport | null {
  return cache.get(key) ?? null;
}

export function setCachedDisclosure(key: string, value: DisclosureReport): void {
  // FIFO eviction — Map preserves insertion order.
  if (cache.size >= MAX_ENTRIES && !cache.has(key)) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, value);
}
