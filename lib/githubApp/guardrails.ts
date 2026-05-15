// Cost guardrails for the GitHub App.
//
// Three layers protect compute + storage from runaway use. None of
// these are about LLM token cost — v1's pipeline is pure deterministic
// rules, so the only "cost" is CPU + bandwidth + disk. Adjust here
// (not at call sites) if we need to relax or tighten.
//
// 1. Repo-size guard       — synchronous, fires in pull_request handler
// 2. Per-installation rate — synchronous, fires in pull_request handler
//                            (wraps existing lib/rateLimit.ts machinery)
// 3. Concurrency slot      — async, fires inside runReview (acquire
//                            before pipeline, release in finally)
//
// Design rationale: eval/strategy/github-app-skeleton-2026-05.md
// §"Cost guardrails".

import { RATE_LIMITS, checkRateLimit } from "../rateLimit";

// ---------------- Limits ----------------

/** Repo size cap at clone-time. Mega-repos eat bandwidth + clone time
 *  + disk and aren't the v1 target. Friendly "reach out for enterprise"
 *  messaging is v1.1 work — for now we just skip silently. */
export const MAX_REPO_SIZE_KB = 102_400; // 100 MB

/** Per-installation concurrent analyses. Two should comfortably fit
 *  Railway's per-process memory; three would risk OOM on a big repo
 *  PR landing while another is mid-clone. */
export const MAX_CONCURRENT_PER_INSTALLATION = 2;

// ---------------- Repo size ----------------

export type GuardResult = { ok: true } | { ok: false; reason: string };

export function checkRepoSizeGuard(
  sizeKb: number | undefined,
): GuardResult {
  // GitHub omits `size` on some payloads (e.g. brand-new repos). Don't
  // block on missing data; let it through and rely on the pipeline's
  // own clone-time errors if the repo really is too large.
  if (sizeKb === undefined) return { ok: true };

  if (sizeKb > MAX_REPO_SIZE_KB) {
    return {
      ok: false,
      reason: `repo size ${sizeKb}KB exceeds limit ${MAX_REPO_SIZE_KB}KB (~100 MB)`,
    };
  }
  return { ok: true };
}

// ---------------- Rate limit ----------------

export function checkInstallationRateLimit(
  installationId: number,
): GuardResult {
  const result = checkRateLimit(
    `gh-install:${installationId}`,
    RATE_LIMITS.githubAppPrPerInstallation,
  );
  if (!result.ok) {
    const minutesUntilReset = Math.max(
      1,
      Math.ceil((result.resetAt - Date.now()) / 60_000),
    );
    return {
      ok: false,
      reason: `installation rate limit exceeded — resets in ~${minutesUntilReset} min`,
    };
  }
  return { ok: true };
}

// ---------------- Concurrency ----------------

// In-memory counter per installation. Lives in this module so the
// import contract is simple: callers don't pass state around. Lost
// on container restart, which is fine — concurrency is a per-process
// concern and there's only one process per container.
const inFlight = new Map<number, number>();

/** Try to claim a concurrency slot for this installation. Returns
 *  true if claimed (caller MUST release in a finally block); false
 *  if the per-installation limit is already reached. */
export function tryAcquireConcurrencySlot(installationId: number): boolean {
  const current = inFlight.get(installationId) ?? 0;
  if (current >= MAX_CONCURRENT_PER_INSTALLATION) return false;
  inFlight.set(installationId, current + 1);
  return true;
}

export function releaseConcurrencySlot(installationId: number): void {
  const current = inFlight.get(installationId) ?? 0;
  if (current <= 1) {
    inFlight.delete(installationId);
  } else {
    inFlight.set(installationId, current - 1);
  }
}

/** Read current in-flight count. Exported for observability (logs,
 *  future telemetry) — not used for any control flow decisions. */
export function getInFlightCount(installationId: number): number {
  return inFlight.get(installationId) ?? 0;
}

/** TEST-ONLY: clear the concurrency map so tests don't bleed state.
 *  Not used in production; the in-memory map is meant to persist
 *  across requests in the same process. */
export function _resetConcurrencyForTest(): void {
  inFlight.clear();
}
