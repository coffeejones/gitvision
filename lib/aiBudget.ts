// Daily kill-switch on Anthropic API usage. Second line of defense after
// the per-IP rate limit (lib/rateLimit.ts) and the spending cap users
// should set on the Anthropic console.
//
// What this protects against: a botched prompt, a bug, or coordinated
// abuse that fires summary/health endpoints faster than the per-IP rate
// limit catches. Without this, a Sunday morning could end with a $200
// Anthropic bill.
//
// Threshold default: 100 calls/day across ALL callers globally. Set
// AI_DAILY_BUDGET in Railway env to override (e.g. 500 once we have
// confidence in usage patterns; 0 to disable AI entirely as a panic
// switch).
//
// Why in-memory not file-based: same reason as the rate limiter —
// simplicity. The worst-case failure mode is that a deploy resets the
// counter mid-day, allowing one full extra cycle. Acceptable; combined
// with the Anthropic spending cap (set in console) the financial blast
// radius is bounded.

interface DailyCounter {
  /** Number of AI calls recorded today. */
  count: number;
  /** Unix-ms timestamp when this counter resets to 0 (next UTC midnight). */
  resetAt: number;
}

let counter: DailyCounter | null = null;

function nextUtcMidnight(): number {
  const d = new Date();
  d.setUTCHours(24, 0, 0, 0);
  return d.getTime();
}

function getDailyLimit(): number {
  const raw = process.env.AI_DAILY_BUDGET;
  if (!raw) return 100;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed < 0) return 100;
  return parsed;
}

export interface AiBudgetResult {
  /** False = caller should refuse to make the AI call and return an
   *  explanatory error to the user. */
  ok: boolean;
  /** How many AI calls remain in today's budget. */
  remaining: number;
  /** When the daily counter resets (next UTC midnight). */
  resetAt: number;
  /** The configured daily limit — useful in error messages. */
  limit: number;
}

/** Check the daily budget WITHOUT recording a call. Use this from UI-
 *  facing endpoints that want to surface a "budget exhausted" message
 *  before attempting work. */
export function peekAiBudget(): AiBudgetResult {
  const limit = getDailyLimit();
  const now = Date.now();
  if (!counter || counter.resetAt <= now) {
    return { ok: limit > 0, remaining: limit, resetAt: nextUtcMidnight(), limit };
  }
  return {
    ok: counter.count < limit,
    remaining: Math.max(0, limit - counter.count),
    resetAt: counter.resetAt,
    limit,
  };
}

/** Atomically check + increment the counter. Call this immediately
 *  before kicking off an Anthropic API request. If `ok` is false, do
 *  not make the request. */
export function consumeAiBudget(): AiBudgetResult {
  const limit = getDailyLimit();
  const now = Date.now();

  if (!counter || counter.resetAt <= now) {
    counter = { count: 0, resetAt: nextUtcMidnight() };
  }

  if (counter.count >= limit) {
    return {
      ok: false,
      remaining: 0,
      resetAt: counter.resetAt,
      limit,
    };
  }

  counter.count++;
  return {
    ok: true,
    remaining: Math.max(0, limit - counter.count),
    resetAt: counter.resetAt,
    limit,
  };
}

/** TEST-ONLY helper. Resets the in-memory counter. */
export function _resetAiBudgetForTest() {
  counter = null;
}
