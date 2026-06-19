import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  _resetRateLimitForTest,
  checkRateLimit,
  getClientIp,
  RATE_LIMITS,
} from "../rateLimit";

beforeEach(() => {
  _resetRateLimitForTest();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("getClientIp", () => {
  it("uses the LAST IP from x-forwarded-for (the real client, not the spoofable first hop)", () => {
    const req = new Request("http://x", {
      headers: { "x-forwarded-for": "1.2.3.4, 5.6.7.8" },
    });
    // 5.6.7.8 is the IP Railway's edge appended; 1.2.3.4 is client-supplied.
    expect(getClientIp(req)).toBe("5.6.7.8");
  });

  it("trims whitespace around the last IP", () => {
    const req = new Request("http://x", {
      headers: { "x-forwarded-for": "1.2.3.4 ,  5.6.7.8  " },
    });
    expect(getClientIp(req)).toBe("5.6.7.8");
  });

  it("ignores a trailing empty entry and uses the last real IP", () => {
    const req = new Request("http://x", {
      headers: { "x-forwarded-for": "1.2.3.4, 5.6.7.8, " },
    });
    expect(getClientIp(req)).toBe("5.6.7.8");
  });

  it("handles a single-IP header (first === last)", () => {
    const req = new Request("http://x", {
      headers: { "x-forwarded-for": "9.8.7.6" },
    });
    expect(getClientIp(req)).toBe("9.8.7.6");
  });

  it("falls back to x-real-ip when x-forwarded-for is missing", () => {
    const req = new Request("http://x", {
      headers: { "x-real-ip": "9.9.9.9" },
    });
    expect(getClientIp(req)).toBe("9.9.9.9");
  });

  it('returns "unknown" when no headers are set', () => {
    const req = new Request("http://x");
    expect(getClientIp(req)).toBe("unknown");
  });

  it('treats empty x-forwarded-for as "unknown" rather than empty string', () => {
    const req = new Request("http://x", {
      headers: { "x-forwarded-for": "" },
    });
    // Empty string should fall through to x-real-ip / "unknown".
    expect(getClientIp(req)).toBe("unknown");
  });
});

describe("checkRateLimit", () => {
  it("allows the first request and counts it", () => {
    const result = checkRateLimit("test:a", { limit: 3, windowMs: 1000 });
    expect(result.ok).toBe(true);
    expect(result.remaining).toBe(2);
  });

  it("counts down across multiple calls within the window", () => {
    const a = checkRateLimit("test:b", { limit: 3, windowMs: 1000 });
    const b = checkRateLimit("test:b", { limit: 3, windowMs: 1000 });
    const c = checkRateLimit("test:b", { limit: 3, windowMs: 1000 });
    expect(a.remaining).toBe(2);
    expect(b.remaining).toBe(1);
    expect(c.remaining).toBe(0);
    expect(c.ok).toBe(true);
  });

  it("rejects the (limit+1)th request as not-ok", () => {
    const opts = { limit: 2, windowMs: 1000 };
    checkRateLimit("test:c", opts);
    checkRateLimit("test:c", opts);
    const third = checkRateLimit("test:c", opts);
    expect(third.ok).toBe(false);
    expect(third.remaining).toBe(0);
  });

  it("resets the bucket after the window elapses", () => {
    vi.useFakeTimers();
    const start = new Date("2026-04-29T12:00:00Z");
    vi.setSystemTime(start);

    const opts = { limit: 1, windowMs: 1000 };
    expect(checkRateLimit("test:d", opts).ok).toBe(true);
    expect(checkRateLimit("test:d", opts).ok).toBe(false);

    // Advance past the window.
    vi.setSystemTime(new Date(start.getTime() + 1500));
    expect(checkRateLimit("test:d", opts).ok).toBe(true);
  });

  it("isolates separate keys", () => {
    const opts = { limit: 1, windowMs: 1000 };
    expect(checkRateLimit("test:e1", opts).ok).toBe(true);
    expect(checkRateLimit("test:e2", opts).ok).toBe(true); // different key, fresh
    expect(checkRateLimit("test:e1", opts).ok).toBe(false);
  });

  it("returns a resetAt timestamp ahead of now", () => {
    vi.useFakeTimers();
    const now = new Date("2026-04-29T12:00:00Z");
    vi.setSystemTime(now);
    const result = checkRateLimit("test:f", { limit: 5, windowMs: 30_000 });
    expect(result.resetAt).toBe(now.getTime() + 30_000);
  });
});

describe("RATE_LIMITS presets", () => {
  it("session create is the strictest endpoint", () => {
    expect(RATE_LIMITS.sessionCreate.limit).toBeLessThanOrEqual(
      RATE_LIMITS.sessionRefresh.limit
    );
    expect(RATE_LIMITS.sessionCreate.limit).toBeLessThanOrEqual(
      RATE_LIMITS.aiGenerate.limit
    );
  });

  it("all presets use a 1-hour window", () => {
    expect(RATE_LIMITS.sessionCreate.windowMs).toBe(3_600_000);
    expect(RATE_LIMITS.sessionRefresh.windowMs).toBe(3_600_000);
    expect(RATE_LIMITS.aiGenerate.windowMs).toBe(3_600_000);
  });
});
