// Stage 3c — the "measure" half of "measure before you build the worker".
//
// The worker_thread offload is deliberately NOT built yet: it's Next-fragile and
// only worth it if the bounded-synchronous compute actually misses its latency
// budget under real prod load. This records the per-simulate compute time + how
// often the gate sheds load, keeps a rolling p50/p95, and logs a greppable rollup
// so that decision rests on data, not a guess. simulateStats() is exported for a
// future debug endpoint; nothing here changes behaviour.

const WINDOW = 200; // rolling sample of recent compute durations
const LOG_EVERY = 25; // emit a rollup line every N simulates

const durations: number[] = [];
let count = 0; // total simulates timed
let shed = 0; // total "busy" rejections
let sinceLog = 0;

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

export interface SimulateStats {
  count: number;
  shed: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
  windowSize: number;
}

/** Snapshot of the rolling compute-timing stats (for a debug endpoint / rollup). */
export function simulateStats(): SimulateStats {
  const sorted = [...durations].sort((a, b) => a - b);
  return {
    count,
    shed,
    p50Ms: percentile(sorted, 50),
    p95Ms: percentile(sorted, 95),
    maxMs: sorted.length > 0 ? sorted[sorted.length - 1] : 0,
    windowSize: sorted.length,
  };
}

/** Record one completed simulate compute. Logs a rollup every LOG_EVERY calls. */
export function recordSimulate(durationMs: number, files: number, gateDepth: number): void {
  count++;
  durations.push(durationMs);
  if (durations.length > WINDOW) durations.shift();
  if (++sinceLog >= LOG_EVERY) {
    sinceLog = 0;
    const s = simulateStats();
    // Greppable in Railway logs: `[faultline-timing]`. The worker decision reads
    // p95 here — if it drifts past ~1s under load, the offload is warranted.
    console.log(
      `[faultline-timing] n=${s.count} shed=${s.shed} p50=${s.p50Ms}ms p95=${s.p95Ms}ms max=${s.maxMs}ms lastFiles=${files} gate=${gateDepth}`,
    );
  }
}

/** Record a "busy" load-shed (the gate was saturated). */
export function recordShed(): void {
  shed++;
}

/** Test hook — reset the rolling window + counters. */
export function resetSimulateTelemetry(): void {
  durations.length = 0;
  count = 0;
  shed = 0;
  sinceLog = 0;
}
