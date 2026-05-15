import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  MAX_CONCURRENT_PER_INSTALLATION,
  MAX_REPO_SIZE_KB,
  _resetConcurrencyForTest,
  checkInstallationRateLimit,
  checkRepoSizeGuard,
  getInFlightCount,
  releaseConcurrencySlot,
  tryAcquireConcurrencySlot,
} from "../githubApp/guardrails";
import { _resetRateLimitForTest } from "../rateLimit";

beforeEach(() => {
  _resetConcurrencyForTest();
  _resetRateLimitForTest();
});

afterEach(() => {
  _resetConcurrencyForTest();
  _resetRateLimitForTest();
});

// ---------------- Repo size ----------------

describe("checkRepoSizeGuard", () => {
  it("allows undefined size (GitHub omits on some payloads)", () => {
    expect(checkRepoSizeGuard(undefined)).toEqual({ ok: true });
  });

  it("allows size at zero (empty repo)", () => {
    expect(checkRepoSizeGuard(0)).toEqual({ ok: true });
  });

  it("allows size just under the cap", () => {
    expect(checkRepoSizeGuard(MAX_REPO_SIZE_KB - 1)).toEqual({ ok: true });
  });

  it("allows size exactly at the cap", () => {
    expect(checkRepoSizeGuard(MAX_REPO_SIZE_KB)).toEqual({ ok: true });
  });

  it("rejects size 1 KB over the cap", () => {
    const result = checkRepoSizeGuard(MAX_REPO_SIZE_KB + 1);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("exceeds limit");
      expect(result.reason).toContain(String(MAX_REPO_SIZE_KB));
    }
  });

  it("rejects size massively over the cap (gigantic monorepo)", () => {
    const result = checkRepoSizeGuard(5_000_000); // 5 GB
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("5000000");
    }
  });
});

// ---------------- Rate limit ----------------

describe("checkInstallationRateLimit", () => {
  it("allows the first request from an installation", () => {
    expect(checkInstallationRateLimit(42).ok).toBe(true);
  });

  it("allows requests up to the limit", () => {
    // Default limit is 10 per hour — let's verify all 10 pass.
    for (let i = 0; i < 10; i++) {
      expect(checkInstallationRateLimit(99).ok).toBe(true);
    }
  });

  it("rejects the 11th request from the same installation", () => {
    for (let i = 0; i < 10; i++) {
      checkInstallationRateLimit(99);
    }
    const result = checkInstallationRateLimit(99);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("rate limit");
      expect(result.reason).toMatch(/resets in/);
    }
  });

  it("tracks separate buckets per installation", () => {
    // Burn through installation A's quota.
    for (let i = 0; i < 10; i++) checkInstallationRateLimit(1);
    expect(checkInstallationRateLimit(1).ok).toBe(false);
    // Installation B should still be untouched.
    expect(checkInstallationRateLimit(2).ok).toBe(true);
  });
});

// ---------------- Concurrency ----------------

describe("tryAcquireConcurrencySlot / releaseConcurrencySlot", () => {
  it("acquires the first slot", () => {
    expect(tryAcquireConcurrencySlot(1)).toBe(true);
    expect(getInFlightCount(1)).toBe(1);
  });

  it("acquires up to MAX_CONCURRENT_PER_INSTALLATION", () => {
    for (let i = 0; i < MAX_CONCURRENT_PER_INSTALLATION; i++) {
      expect(tryAcquireConcurrencySlot(1)).toBe(true);
    }
    expect(getInFlightCount(1)).toBe(MAX_CONCURRENT_PER_INSTALLATION);
  });

  it("rejects acquire past the limit", () => {
    for (let i = 0; i < MAX_CONCURRENT_PER_INSTALLATION; i++) {
      tryAcquireConcurrencySlot(1);
    }
    expect(tryAcquireConcurrencySlot(1)).toBe(false);
  });

  it("releases a slot so a new acquire can succeed", () => {
    for (let i = 0; i < MAX_CONCURRENT_PER_INSTALLATION; i++) {
      tryAcquireConcurrencySlot(1);
    }
    expect(tryAcquireConcurrencySlot(1)).toBe(false);
    releaseConcurrencySlot(1);
    expect(tryAcquireConcurrencySlot(1)).toBe(true);
  });

  it("tracks separate counters per installation", () => {
    // Fill installation A.
    for (let i = 0; i < MAX_CONCURRENT_PER_INSTALLATION; i++) {
      tryAcquireConcurrencySlot(1);
    }
    expect(tryAcquireConcurrencySlot(1)).toBe(false);
    // B should be unaffected.
    expect(tryAcquireConcurrencySlot(2)).toBe(true);
    expect(getInFlightCount(1)).toBe(MAX_CONCURRENT_PER_INSTALLATION);
    expect(getInFlightCount(2)).toBe(1);
  });

  it("release on an empty installation is a no-op (no negative counts)", () => {
    releaseConcurrencySlot(999);
    releaseConcurrencySlot(999);
    expect(getInFlightCount(999)).toBe(0);
    expect(tryAcquireConcurrencySlot(999)).toBe(true);
  });

  it("deletes the map entry when count reaches zero (no slow leak)", () => {
    tryAcquireConcurrencySlot(7);
    releaseConcurrencySlot(7);
    expect(getInFlightCount(7)).toBe(0);
  });

  it("getInFlightCount returns 0 for an installation we've never seen", () => {
    expect(getInFlightCount(42)).toBe(0);
  });
});
