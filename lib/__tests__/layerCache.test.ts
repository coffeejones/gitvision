// Stage 3b: the warm parse-layer LRU — hit/miss, recency-aware eviction, and the
// big-layer skip. (The "safe to reuse one instance" invariant the cache relies on
// is pinned in shadowGraphSimulate.test.ts.)

import { describe, it, expect, beforeEach } from "vitest";
import { getWarmLayer, putWarmLayer, clearWarmLayers } from "../shadowGraph/layerCache";
import type { ParseCacheEntry } from "../shadowGraph/parseCache";

// putWarmLayer only reads entry.files.length, so a file-count stub suffices.
const stub = (files: number) =>
  ({ files: new Array(files).fill(0) } as unknown as ParseCacheEntry);

describe("warm layer cache (Stage 3b)", () => {
  beforeEach(() => clearWarmLayers());

  it("hits for a cached digest and misses for unknown ones", () => {
    expect(getWarmLayer("d1")).toBeUndefined();
    putWarmLayer("d1", stub(3));
    expect(getWarmLayer("d1")).toBeDefined();
    expect(getWarmLayer("nope")).toBeUndefined();
  });

  it("evicts the least-recently-used beyond the entry budget", () => {
    for (let i = 0; i < 8; i++) putWarmLayer(`d${i}`, stub(1));
    // Touch d0 → it's newest now; d1 becomes the oldest.
    expect(getWarmLayer("d0")).toBeDefined();
    putWarmLayer("d8", stub(1)); // 9th entry → over MAX_ENTRIES (8)
    expect(getWarmLayer("d1")).toBeUndefined(); // LRU-evicted
    expect(getWarmLayer("d0")).toBeDefined(); // recently used → survived
    expect(getWarmLayer("d8")).toBeDefined(); // newest
  });

  it("skips a layer larger than the whole budget", () => {
    putWarmLayer("huge", stub(20_000)); // > MAX_TOTAL_FILES
    expect(getWarmLayer("huge")).toBeUndefined();
  });
});
