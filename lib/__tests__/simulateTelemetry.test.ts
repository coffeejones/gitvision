// Stage 3c: the simulate-timing telemetry — rolling p50/p95, shed counting, and
// the capped window that feeds the eventual worker decision.

import { describe, it, expect, beforeEach } from "vitest";
import {
  recordSimulate,
  recordShed,
  simulateStats,
  resetSimulateTelemetry,
} from "../shadowGraph/simulateTelemetry";

describe("simulate telemetry (Stage 3c)", () => {
  beforeEach(() => resetSimulateTelemetry());

  it("starts empty", () => {
    expect(simulateStats()).toMatchObject({
      count: 0,
      shed: 0,
      p50Ms: 0,
      p95Ms: 0,
      maxMs: 0,
      windowSize: 0,
    });
  });

  it("computes rolling p50 / p95 / max over recorded durations", () => {
    for (let i = 1; i <= 10; i++) recordSimulate(i * 10, 100, 1); // 10..100ms
    const s = simulateStats();
    expect(s.count).toBe(10);
    expect(s.windowSize).toBe(10);
    expect(s.p50Ms).toBe(60);
    expect(s.p95Ms).toBe(100);
    expect(s.maxMs).toBe(100);
  });

  it("counts sheds independently of timed simulates", () => {
    recordShed();
    recordShed();
    const s = simulateStats();
    expect(s.shed).toBe(2);
    expect(s.count).toBe(0);
  });

  it("caps the rolling window while the total keeps counting", () => {
    for (let i = 0; i < 250; i++) recordSimulate(5, 100, 0);
    const s = simulateStats();
    expect(s.count).toBe(250); // lifetime total
    expect(s.windowSize).toBe(200); // rolling window capped
  });
});
