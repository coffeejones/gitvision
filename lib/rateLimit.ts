// IP-based in-memory rate limiter for the public alpha deploy.
//
// Why in-memory: simplicity. A file-based or DB-backed limiter would be
// more robust but adds infrastructure for a soft limit. The worst case
// of an in-memory limiter is that a Railway redeploy resets the counters
// — which is acceptable; the abuse window is bounded by the next deploy.
//
// What we protect against:
//   - Casual abuse: someone running a bot that POSTs /api/sessions in a
//     loop, eating CPU/memory and Anthropic budget.
//   - Accidental loops: a buggy frontend / curl script firing repeatedly.
//
// What we DO NOT protect against:
//   - Distributed abuse: many IPs each making one request. That requires
//     a CAPTCHA / cloudflare turnstile / similar.
//   - Sophisticated rotating-proxy abuse. Out of scope for an alpha.
//
// Headers we trust to identify the caller (in priority order):
//   - X-Forwarded-For: Railway's edge APPENDS the connecting IP rather
//     than replacing a client-supplied header, so we trust the LAST hop
//     (the real client) — not the spoofable first entry. See getClientIp.
//   - X-Real-IP: fallback if X-Forwarded-For is missing.
//   - "unknown": worst case — treat all anonymous callers as a single
//     bucket. Strict, but avoids "no header → unlimited".

interface Bucket {
  /** Number of requests recorded in the current window. */
  count: number;
  /** Unix-ms timestamp when this bucket resets to 0. */
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

export interface RateLimitResult {
  /** False = request should be rejected with 429. */
  ok: boolean;
  /** How many more requests this caller can make in the current window. */
  remaining: number;
  /** Unix-ms timestamp when the limit resets — useful for Retry-After. */
  resetAt: number;
}

export interface RateLimitOpts {
  /** Max requests in the window. */
  limit: number;
  /** Window length in ms (e.g. 3_600_000 for 1 hour). */
  windowMs: number;
}

/** Pull the client IP out of common reverse-proxy headers. Falls back to
 *  "unknown" so a missing header doesn't bypass the limit entirely. */
export function getClientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    // X-Forwarded-For is a chain "client, proxy1, proxy2, …". The LEFTMOST
    // entry is attacker-controllable: Railway's edge appends (doesn't strip)
    // a client-supplied header, so spoofing "X-Forwarded-For: <random>"
    // would hand out a fresh rate-limit bucket on every request. The
    // RIGHTMOST entry is the IP that actually connected to Railway's edge —
    // the real client — and can't be forged. Trust that one.
    //
    // Assumes a single trusted hop (Railway's edge). If another reverse
    // proxy is ever placed in front, this must account for the extra hop.
    const parts = xff
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);
    const last = parts[parts.length - 1];
    if (last) return last;
  }
  const real = req.headers.get("x-real-ip");
  if (real) return real.trim();
  return "unknown";
}

/** Check + record a request against the rate limit. The key namespaces
 *  the bucket so different endpoints have separate counters for the same
 *  caller (e.g. sessions:1.2.3.4 vs refresh:1.2.3.4). */
export function checkRateLimit(
  key: string,
  opts: RateLimitOpts
): RateLimitResult {
  // Best-effort cleanup of expired buckets so the Map doesn't grow
  // without bound. We sample 5 random keys per call — amortized O(1)
  // and good enough for an alpha-scale service.
  cleanupExpired();

  const now = Date.now();
  const existing = buckets.get(key);

  if (!existing || existing.resetAt <= now) {
    const fresh: Bucket = { count: 1, resetAt: now + opts.windowMs };
    buckets.set(key, fresh);
    return { ok: true, remaining: opts.limit - 1, resetAt: fresh.resetAt };
  }

  if (existing.count >= opts.limit) {
    return { ok: false, remaining: 0, resetAt: existing.resetAt };
  }

  existing.count++;
  return {
    ok: true,
    remaining: opts.limit - existing.count,
    resetAt: existing.resetAt,
  };
}

function cleanupExpired() {
  if (buckets.size < 50) return; // not worth the work
  const now = Date.now();
  let inspected = 0;
  for (const [key, bucket] of buckets) {
    if (inspected++ > 5) break;
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

/** TEST-ONLY helper. Resets the in-memory store so tests can run
 *  independently without leaking state between cases. NOT exported as
 *  part of the public API — bundlers that don't tree-shake will keep
 *  this in production but it's a no-op there. */
export function _resetRateLimitForTest() {
  buckets.clear();
}

// Standardized presets so the call-sites don't drift apart. Tweak in
// one place if we want to relax/tighten across the board.
export const RATE_LIMITS = {
  /** Session creation — full pipeline, expensive (CPU + memory + git
   *  clone + GitHub API quota). Strict per-IP cap. */
  sessionCreate: { limit: 5, windowMs: 60 * 60_000 },
  /** Refresh — same cost as create, but power users do hit it more
   *  often when iterating. Slightly more lenient. */
  sessionRefresh: { limit: 10, windowMs: 60 * 60_000 },
  /** AI generation endpoints — cheap CPU but real $$ to Anthropic.
   *  Layered with the daily AI budget kill-switch in lib/aiBudget.ts. */
  aiGenerate: { limit: 20, windowMs: 60 * 60_000 },
  /** Change simulation — sub-second per call (only changed files re-parse) and
   *  the payload is byte-capped by the patch DoS gate, but it's synchronous
   *  tree-sitter work on the shared loop, so bound the per-IP burst. Generous
   *  enough for interactive diff iteration (~1/min sustained). */
  sessionSimulate: { limit: 60, windowMs: 60 * 60_000 },
  /** GitHub App PR analyses per installation — protects against a
   *  repo firing pull_request events in a flood (e.g. force-pushing
   *  50 branches back-to-back). Soft-fail: skip + log, don't post a
   *  comment, GitHub gets 200 either way. */
  githubAppPrPerInstallation: { limit: 10, windowMs: 60 * 60_000 },
} as const;
