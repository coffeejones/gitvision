// Global concurrency gate for the simulate compute (Stage 3a).
//
// A simulate is O(repo) SYNCHRONOUS work on the single Node event loop — the DoS
// the review confirmed (the byte caps bound only the touched-file re-parse, not
// the whole-graph rebuild). Two simulates can't truly run at once (JS is
// single-threaded), so a flood doesn't parallelize — it just piles up pending
// runs, each holding a parse layer + partial graphs in memory, and starves every
// other request. This gate caps how many run concurrently and how many may wait,
// fast-rejecting the overflow as "busy" (a retryable 503) instead of letting the
// backlog grow unbounded.
//
// The concurrency cap is also exactly the knob a Stage 3c worker pool would set —
// when the worker lands, MAX_CONCURRENT becomes the pool size and the bodies run
// off-thread. Until then it bounds the main-thread backlog.

/** Raised when the compute gate is saturated (all slots busy + the wait queue is
 *  full). Surfaces as a retryable "busy" outcome, never a crash. */
export class ComputeBusyError extends Error {
  constructor(message = "Simulation is busy — too many changes in flight.") {
    super(message);
    this.name = "ComputeBusyError";
  }
}

export interface GateLimits {
  /** Max simulate computes in flight at once. Small — they serialize on the loop
   *  anyway; this bounds held memory + becomes the worker-pool size in Stage 3c. */
  maxConcurrent?: number;
  /** Max runs allowed to wait for a slot before we start shedding load. */
  maxQueued?: number;
}

const DEFAULTS: Required<GateLimits> = { maxConcurrent: 2, maxQueued: 6 };

let active = 0;
const waiters: Array<() => void> = [];

/** Run `fn` under the global gate. Acquires a slot (waiting if all are busy but
 *  the queue has room), runs, then hands the slot to the next waiter — so the
 *  active count is a true in-flight count with no acquire/release race. Throws
 *  ComputeBusyError immediately when both slots and queue are full. */
export async function runGated<T>(
  fn: () => Promise<T>,
  limits: GateLimits = {},
): Promise<T> {
  const maxConcurrent = limits.maxConcurrent ?? DEFAULTS.maxConcurrent;
  const maxQueued = limits.maxQueued ?? DEFAULTS.maxQueued;

  if (active >= maxConcurrent) {
    if (waiters.length >= maxQueued) throw new ComputeBusyError();
    // Wait for a slot. The releaser transfers its slot to us (active unchanged),
    // so we must NOT increment on this path.
    await new Promise<void>((resolve) => waiters.push(resolve));
  } else {
    active++;
  }

  try {
    return await fn();
  } finally {
    const next = waiters.shift();
    if (next) next(); // transfer our slot to the next waiter — active stays put
    else active--; // no one waiting — release the slot
  }
}

/** Live gate depth — exported for a timing/introspection surface (Stage 3c). */
export function gateInFlight(): number {
  return active;
}
