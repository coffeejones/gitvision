import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  _resetAiBudgetForTest,
  consumeAiBudget,
  peekAiBudget,
} from "../aiBudget";

beforeEach(() => {
  _resetAiBudgetForTest();
  delete process.env.AI_DAILY_BUDGET;
});

afterEach(() => {
  vi.useRealTimers();
  delete process.env.AI_DAILY_BUDGET;
});

describe("peekAiBudget", () => {
  it("reports the default limit of 100 when no env var is set", () => {
    const result = peekAiBudget();
    expect(result.limit).toBe(100);
    expect(result.remaining).toBe(100);
    expect(result.ok).toBe(true);
  });

  it("respects AI_DAILY_BUDGET env var", () => {
    process.env.AI_DAILY_BUDGET = "5";
    const result = peekAiBudget();
    expect(result.limit).toBe(5);
    expect(result.remaining).toBe(5);
  });

  it("treats AI_DAILY_BUDGET=0 as a kill switch", () => {
    process.env.AI_DAILY_BUDGET = "0";
    const result = peekAiBudget();
    expect(result.limit).toBe(0);
    expect(result.ok).toBe(false);
  });

  it("ignores invalid env values and falls back to 100", () => {
    process.env.AI_DAILY_BUDGET = "not-a-number";
    expect(peekAiBudget().limit).toBe(100);
  });

  it("ignores negative env values and falls back to 100", () => {
    process.env.AI_DAILY_BUDGET = "-5";
    expect(peekAiBudget().limit).toBe(100);
  });

  it("does not increment the counter (peek-only)", () => {
    peekAiBudget();
    peekAiBudget();
    peekAiBudget();
    expect(peekAiBudget().remaining).toBe(100);
  });
});

describe("consumeAiBudget", () => {
  it("decrements remaining on each call", () => {
    process.env.AI_DAILY_BUDGET = "3";
    expect(consumeAiBudget().remaining).toBe(2);
    expect(consumeAiBudget().remaining).toBe(1);
    expect(consumeAiBudget().remaining).toBe(0);
  });

  it("rejects calls past the limit with ok=false", () => {
    process.env.AI_DAILY_BUDGET = "2";
    expect(consumeAiBudget().ok).toBe(true);
    expect(consumeAiBudget().ok).toBe(true);
    const third = consumeAiBudget();
    expect(third.ok).toBe(false);
    expect(third.remaining).toBe(0);
  });

  it("does NOT increment when rejected", () => {
    process.env.AI_DAILY_BUDGET = "1";
    consumeAiBudget(); // count = 1
    consumeAiBudget(); // rejected
    consumeAiBudget(); // also rejected
    // Peek should still see 0 remaining (count stayed at 1, not 3).
    expect(peekAiBudget().remaining).toBe(0);
    expect(peekAiBudget().ok).toBe(false);
  });

  it("resets at next UTC midnight", () => {
    vi.useFakeTimers();
    // Set to 23:00 UTC on April 29
    vi.setSystemTime(new Date("2026-04-29T23:00:00Z"));
    process.env.AI_DAILY_BUDGET = "1";

    expect(consumeAiBudget().ok).toBe(true);
    expect(consumeAiBudget().ok).toBe(false);

    // Advance to 00:01 UTC the next day — past midnight.
    vi.setSystemTime(new Date("2026-04-30T00:01:00Z"));
    expect(consumeAiBudget().ok).toBe(true); // counter reset
  });

  it("returns the configured limit in the result", () => {
    process.env.AI_DAILY_BUDGET = "42";
    expect(consumeAiBudget().limit).toBe(42);
  });

  it("works with the default limit when env is unset", () => {
    // Default is 100; consume 1, expect remaining 99.
    expect(consumeAiBudget().remaining).toBe(99);
  });

  it("kill-switch (AI_DAILY_BUDGET=0) rejects every call immediately", () => {
    process.env.AI_DAILY_BUDGET = "0";
    expect(consumeAiBudget().ok).toBe(false);
    expect(consumeAiBudget().ok).toBe(false);
  });
});
