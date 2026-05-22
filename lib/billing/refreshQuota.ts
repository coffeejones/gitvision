// Refresh-quota enforcement for tier-limited refresh rates.
//
// Scout tier gets 5 refreshes per calendar day. Knight + Baron are
// unlimited (limit = -1 in TIER_CONFIG).
//
// The counter lives on user.dailyRefreshCount + user.dailyRefreshDate
// (YYYY-MM-DD). Each refresh call resets count to 1 when the date
// rolls over to a new day, then increments + checks the cap.
//
// We do this in two DB calls (SELECT + UPDATE) rather than one atomic
// upsert because better-sqlite3's API doesn't have a clean way to do
// conditional-update-with-return in a single statement. The race
// window is tiny (a refresh takes 20+ seconds, the quota check is
// microseconds), and the worst-case race outcome is one extra refresh
// at the boundary — not a security or billing issue.

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { getUserTier } from "@/lib/billing/gates";
import { TIER_CONFIG } from "@/lib/pricing";

export interface RefreshQuotaResult {
  /** Whether the refresh is allowed to proceed */
  allowed: boolean;
  /** How many refreshes the user has consumed today (after this
   *  request — so if allowed, includes the just-tried one). */
  used: number;
  /** Daily cap for the user's current tier. -1 = unlimited. */
  max: number;
  /** Human-readable reason when allowed=false */
  reason?: string;
}

/** Format today's date as YYYY-MM-DD in UTC. We use UTC so daily
 *  rollover happens at midnight UTC regardless of where the user
 *  lives — slightly less natural for individuals but simpler ops
 *  semantics (one global rollover clock, no DST surprises). */
function todayUtc(): string {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Check-and-increment the refresh counter for a user. Returns the
 *  quota state after the operation. When `allowed=false`, the
 *  counter is NOT incremented — caller should return 429 to the
 *  client without performing the refresh.
 *
 *  Knight + Baron tiers bypass the cap (limit = -1) but the counter
 *  still updates for observability — useful if we later want to
 *  show "X refreshes today" stats to power users. */
export async function checkAndIncrementRefresh(
  userId: string,
): Promise<RefreshQuotaResult> {
  const tier = await getUserTier(userId);
  const max = TIER_CONFIG[tier].limits.refreshesPerDay;
  const today = todayUtc();

  // Read current counter state
  const rows = await db
    .select({
      count: schema.user.dailyRefreshCount,
      date: schema.user.dailyRefreshDate,
    })
    .from(schema.user)
    .where(eq(schema.user.id, userId))
    .limit(1);

  const row = rows[0];
  if (!row) {
    // User row missing — shouldn't happen for an authenticated request,
    // but fail closed: deny the refresh + log
    console.error(
      `[refreshQuota] User ${userId} not found while checking refresh quota`,
    );
    return {
      allowed: false,
      used: 0,
      max,
      reason: "User record missing",
    };
  }

  // If the day rolled over, reset to 1; otherwise increment
  const isNewDay = row.date !== today;
  const newCount = isNewDay ? 1 : row.count + 1;

  // Enforce cap. -1 means unlimited.
  const wouldExceed = max !== -1 && newCount > max;

  if (wouldExceed) {
    return {
      allowed: false,
      used: row.count,
      max,
      reason: `You've used ${row.count} of ${max} refreshes today. Upgrade to Knight for unlimited.`,
    };
  }

  // Allowed — update the counter
  await db
    .update(schema.user)
    .set({
      dailyRefreshCount: newCount,
      dailyRefreshDate: today,
      updatedAt: new Date(),
    })
    .where(eq(schema.user.id, userId));

  return {
    allowed: true,
    used: newCount,
    max,
  };
}

/** Read the user's current refresh quota state without incrementing.
 *  Used by the UI to show "X of Y refreshes today" hints before the
 *  user actually clicks refresh. */
export async function getRefreshQuota(
  userId: string,
): Promise<{ used: number; max: number }> {
  const tier = await getUserTier(userId);
  const max = TIER_CONFIG[tier].limits.refreshesPerDay;
  const today = todayUtc();

  const rows = await db
    .select({
      count: schema.user.dailyRefreshCount,
      date: schema.user.dailyRefreshDate,
    })
    .from(schema.user)
    .where(eq(schema.user.id, userId))
    .limit(1);

  const row = rows[0];
  if (!row || row.date !== today) {
    return { used: 0, max };
  }
  return { used: row.count, max };
}
