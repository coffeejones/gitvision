// Stage 3a: the simulate compute gate caps concurrency, queues a bounded few,
// sheds the overflow as ComputeBusyError, and hands slots to waiters cleanly.

import { describe, it, expect } from "vitest";
import { runGated, ComputeBusyError, gateInFlight } from "../shadowGraph/computeGate";

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe("computeGate", () => {
  it("caps concurrency, queues one, sheds overflow, then drains to zero", async () => {
    const limits = { maxConcurrent: 2, maxQueued: 1 };
    const gates = [deferred<void>(), deferred<void>(), deferred<void>()];
    const started = [false, false, false];

    const run = (i: number) =>
      runGated(async () => {
        started[i] = true;
        await gates[i].promise;
        return i;
      }, limits);

    const p0 = run(0); // slot 1
    const p1 = run(1); // slot 2
    const p2 = run(2); // queued (waiters = 1)

    // Two run immediately; the third waits for a slot.
    expect(started[0]).toBe(true);
    expect(started[1]).toBe(true);
    expect(started[2]).toBe(false);
    expect(gateInFlight()).toBe(2);

    // Slots full (2) AND queue full (1) → the fourth is shed as busy.
    await expect(
      runGated(async () => "nope", limits),
    ).rejects.toBeInstanceOf(ComputeBusyError);

    // Finishing slot 0 hands its slot to the queued run — in-flight stays 2.
    gates[0].resolve();
    expect(await p0).toBe(0);
    await Promise.resolve();
    expect(started[2]).toBe(true);
    expect(gateInFlight()).toBe(2);

    // Drain the rest; no waiters left → the count falls to zero.
    gates[1].resolve();
    gates[2].resolve();
    expect(await p1).toBe(1);
    expect(await p2).toBe(2);
    expect(gateInFlight()).toBe(0);
  });

  it("runs a lone task immediately and releases its slot", async () => {
    expect(gateInFlight()).toBe(0);
    const r = await runGated(async () => 42, { maxConcurrent: 1, maxQueued: 0 });
    expect(r).toBe(42);
    expect(gateInFlight()).toBe(0);
  });

  it("propagates the body's error and still releases the slot", async () => {
    await expect(
      runGated(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(gateInFlight()).toBe(0);
  });
});
