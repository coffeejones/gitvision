// Server-side tier-check helpers for feature gating.
//
// All feature gates resolve through these functions, which read the
// user's current tier from the DB and look up limits in TIER_CONFIG.
// Single point of truth so we can iterate tier strategy in lib/
// pricing.ts and the gates pick it up automatically.
//
// "open-case" is the fallback for any unknown / unauthenticated caller.
// Gates that require login should check session before calling these
// (otherwise an anonymous request lands on Free limits, which is the
// strictest available — safe default).
//
// Server-only. Never import from a Client Component.

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import {
  TIER_CONFIG,
  type TierConfig,
  type TierLimits,
} from "@/lib/pricing";
import type { Tier } from "@/components/TierIcon";

/** Resolve a user's current subscription tier from the database.
 *  Defaults to "open-case" for any user without a tier set (covers
 *  legacy rows from before P3 schema migration, plus the case where
 *  Polar webhook hasn't fired yet for a brand-new signup). */
export async function getUserTier(userId: string): Promise<Tier> {
  const rows = await db
    .select({ tier: schema.user.tier })
    .from(schema.user)
    .where(eq(schema.user.id, userId))
    .limit(1);
  const raw = rows[0]?.tier;
  if (raw === "standing-docket" || raw === "full-bench") return raw;
  // Legacy tier names from before the Scout/Knight/Baron → Free/
  // Plus/Pro rename (1:1). Map them so a user who
  // subscribed before the rename keeps their paid tier across the app —
  // and so reading a legacy row never yields a non-TIER_CONFIG key.
  if (raw === "knight") return "standing-docket";
  if (raw === "baron") return "full-bench";
  return "open-case"; // scout, null, or anything unrecognized
}

/** Get the limits object for a user's current tier. Useful for
 *  rendering "X of Y" counters (eg "3 of 5 refreshes today"). */
export async function getUserLimits(userId: string): Promise<TierLimits> {
  const tier = await getUserTier(userId);
  return TIER_CONFIG[tier].limits;
}

/** Get the full tier config (name, pricing, feature bullets) for a
 *  user. Used by the BillingPanel and any other surface that needs
 *  to show "you're currently on X". */
export async function getUserTierConfig(
  userId: string,
): Promise<TierConfig> {
  const tier = await getUserTier(userId);
  return TIER_CONFIG[tier];
}

/** Boolean feature-flag check. Pass the user id and a limit key —
 *  returns true if the user's tier grants access. */
export async function canAccess(
  userId: string,
  feature: BooleanFeature,
): Promise<boolean> {
  const limits = await getUserLimits(userId);
  return limits[feature];
}

/** Type-safe enumeration of boolean feature flags in TierLimits.
 *  Excludes numeric quota fields (savedSessions, refreshesPerDay,
 *  prBotRepos) which need their own counted-check helpers. */
export type BooleanFeature =
  | "privateRepos"
  | "aiInsights"
  | "architectureDiagrams"
  | "structuralDiff"
  | "refactorGuidance"
  | "testQuality"
  | "simulate"
  | "sbomExport"
  | "teamWorkspaces"
  | "prioritySupport"
  | "earlyAccess"
  | "apiAccess";

/** Quota-style check for numeric limits. Returns true when the
 *  user's tier allows MORE than `currentCount` of the resource (-1
 *  on the limit = unlimited). */
export async function withinQuota(
  userId: string,
  feature: QuotaFeature,
  currentCount: number,
): Promise<boolean> {
  const limits = await getUserLimits(userId);
  const cap = limits[feature];
  if (cap === -1) return true; // unlimited
  return currentCount < cap;
}

export type QuotaFeature =
  | "savedSessions"
  | "refreshesPerDay"
  | "prBotRepos"
  | "watchedRepos";

/** Format a tier name for display (capitalized) — used by gates +
 *  upgrade prompts so we don't have to repeat the same conversion
 *  everywhere. */
export function tierDisplayName(tier: Tier): string {
  return TIER_CONFIG[tier].name;
}

/** Lowest tier that grants a given boolean feature. Used by
 *  UpgradePrompt to render "Upgrade to Plus" or "Upgrade
 *  to Pro" depending on what's needed. */
export function minimumTierFor(feature: BooleanFeature): Tier {
  if (TIER_CONFIG["standing-docket"].limits[feature]) return "standing-docket";
  if (TIER_CONFIG["full-bench"].limits[feature]) return "full-bench";
  // Shouldn't happen in practice — every feature flag should be
  // unlocked at some tier. Fallback to Pro as the safest answer.
  return "full-bench";
}
