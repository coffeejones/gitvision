// Central pricing configuration for CodeTrawl tiers (v0.78).
//
// Single source of truth for tier pricing, features, and limits. The
// /pricing page reads from here for display copy, the auth-gating
// layer reads from here to decide what a user can access, and the
// Polar.sh webhook handler maps Polar product IDs back to tier IDs
// through the same map.
//
// To adjust pricing or features:
//   1. Update the TIER_CONFIG below
//   2. Mirror the change in Polar.sh dashboard (product + price)
//   3. Re-deploy — no other code changes required
//
// To add a new tier (e.g. "Daily docket" between Free and
// Plus):
//   1. Add it to the Tier union type in components/TierIcon.tsx
//   2. Add a lucide-react icon mapping in TierIcon.tsx
//   3. Add an entry to TIER_CONFIG here
//   4. Update Polar.sh with new product + prices

import type { Tier } from "@/components/TierIcon";

export interface TierLimits {
  /** Max saved sessions. -1 = unlimited */
  savedSessions: number;
  /** Refreshes per day. -1 = unlimited */
  refreshesPerDay: number;
  /** PR-bot can install on this many repos. -1 = unlimited */
  prBotRepos: number;
  /** Repos that can be put on Watch (re-sweep + regression alerts).
   *  0 = feature off for this tier. -1 = unlimited */
  watchedRepos: number;
  /** Allow private GitHub repos for analysis */
  privateRepos: boolean;
  /** AI Briefing + Health Check unlocked */
  aiInsights: boolean;
  /** Architecture (class diagrams) tab unlocked */
  architectureDiagrams: boolean;
  /** Structural diff between snapshots */
  structuralDiff: boolean;
  /** Refactor guidance — the Impact-Ranked Test Prioritizer ("run these
   *  tests before touching this file") in the Refactor tab. */
  refactorGuidance: boolean;
  /** Test-quality (Weak-Suite) — the per-test-file assertion-quality report
   *  ("coverage that means nothing") in the Test Quality tab (Arc 1). */
  testQuality: boolean;
  /** Change-simulation (Shadow-Graph "Faultline") — propose a diff against a
   *  cached snapshot and get back a deterministic blast report + a
   *  required-actions verdict ("you touched a load-bearing wall with no guarding
   *  test") BEFORE committing. The conscience layer; gates the web /simulate
   *  route. */
  simulate: boolean;
  /** SBOM export — download a timestamped CycloneDX / SPDX bill of materials
   *  for a snapshot (Arc 4, Pro-only evidence feature). */
  sbomExport: boolean;
  /** Team workspaces (multi-user). NOT IMPLEMENTED — there is no team, org or
   *  membership model anywhere in the product (lib/db/schema.ts defines only
   *  user, session, account, verification and watch). The flag is kept so the
   *  gate exists the day it ships, but it must stay false on every tier until
   *  then: it was advertised on Pro without an implementation behind it, and a
   *  buyer discovering that costs more than the feature would have earned. */
  teamWorkspaces: boolean;
  /** Priority support channel */
  prioritySupport: boolean;
  /** Early access feature flags */
  earlyAccess: boolean;
  /** API access (future) */
  apiAccess: boolean;
}

export interface TierConfig {
  /** Internal tier id — used everywhere in code */
  id: Tier;
  /** Display name */
  name: string;
  /** One-line tagline shown on pricing cards */
  tagline: string;
  /** Monthly price in USD. 0 = free */
  monthlyPriceUsd: number;
  /** Annual price in USD (per year, not per month). 0 = free */
  annualPriceUsd: number;
  /** Polar.sh product ID for monthly subscription — filled in after
   *  Polar setup. Empty string until then; webhook handler should
   *  refuse to process events for tiers without a configured id. */
  polarProductIdMonthly: string;
  /** Polar.sh product ID for annual subscription */
  polarProductIdAnnual: string;
  /** Limits + feature flags for this tier */
  limits: TierLimits;
  /** Feature bullets to display on the pricing card. Order matters —
   *  most important / differentiating first. */
  featureBullets: string[];
  /** When true, this tier gets the "Recommended" badge on the
   *  pricing page. Should be exactly one tier. */
  isRecommended: boolean;
}

export const TIER_CONFIG: Record<Tier, TierConfig> = {
  "open-case": {
    id: "open-case",
    name: "Free",
    tagline: "The whole tool, on one repo. No card required.",
    monthlyPriceUsd: 0,
    annualPriceUsd: 0,
    polarProductIdMonthly: "",
    polarProductIdAnnual: "",
    // FREE-PHASE (pre-traction): the whole toolset is unlocked on Free so the
    // product can actually be seen, shown, and shared — a paywall over the
    // "wow" surfaces (AI, architecture, Faultline, private repos) was killing
    // word-of-mouth at essentially zero real revenue. The ONLY paid axis for
    // now is PERSISTENCE + SCALE: Free keeps exactly one repo (savedSessions: 1,
    // auto-replaced on the next analysis) and can't run the recurring-cost
    // monitoring (Watch, PR-bot). To re-monetize a surface later, flip its flag
    // back to false here — every gate reads this table via canAccess(), so
    // nothing else needs touching (and /pricing + the upsell copy follow along).
    limits: {
      savedSessions: 1,
      refreshesPerDay: 5,
      prBotRepos: 0,
      watchedRepos: 0,
      privateRepos: true,
      aiInsights: true,
      architectureDiagrams: true,
      structuralDiff: true,
      refactorGuidance: true,
      testQuality: true,
      simulate: true,
      sbomExport: false,
      teamWorkspaces: false,
      prioritySupport: false,
      earlyAccess: false,
      apiAccess: false,
    },
    featureBullets: [
      "One repo at a time — public or private",
      "Every panel unlocked: AI briefing, architecture, test quality",
      "Faultline change-simulation — see what a diff breaks first",
      "Refactor guidance + structural diffs",
      "5 refreshes per day",
      "Browse all demo repos",
    ],
    isRecommended: false,
  },
  "standing-docket": {
    id: "standing-docket",
    name: "Plus",
    tagline: "For repos you live in.",
    monthlyPriceUsd: 14.99,
    annualPriceUsd: 149.99,
    polarProductIdMonthly: "41dd4d70-8aeb-4bf9-9910-2528fd9cc389",
    polarProductIdAnnual: "18fb0cc2-9fc7-4829-84fd-32ab65599764",
    limits: {
      savedSessions: -1,
      refreshesPerDay: -1,
      prBotRepos: 5,
      watchedRepos: 5,
      privateRepos: true,
      aiInsights: true,
      architectureDiagrams: true,
      structuralDiff: true,
      refactorGuidance: true,
      testQuality: true,
      simulate: true,
      sbomExport: false,
      teamWorkspaces: false,
      prioritySupport: false,
      earlyAccess: false,
      apiAccess: false,
    },
    featureBullets: [
      "Keep unlimited repos — no one-at-a-time limit",
      "A grade on every pull request (up to 5 repos)",
      "Regression watch: daily re-sweep + alerts (5 repos)",
      "Unlimited refreshes — re-sweep as often as you like",
      "Everything in Free, unbounded",
    ],
    isRecommended: true,
  },
  "full-bench": {
    id: "full-bench",
    name: "Pro",
    // Not "For the whole org." — that promised multi-user, which the product
    // does not have. Pro's real axis is breadth: unlimited PR-bot and Watch
    // repos where Plus caps both at 5, plus the SBOM/evidence export.
    tagline: "For every repo you own.",
    monthlyPriceUsd: 39,
    annualPriceUsd: 390,
    polarProductIdMonthly: "8e8cbfe1-9e40-4b8c-a328-0fc8625a6353",
    polarProductIdAnnual: "fd4941ba-b72d-4867-b8e5-0c8ab6d35b95",
    limits: {
      savedSessions: -1,
      refreshesPerDay: -1,
      prBotRepos: -1,
      watchedRepos: -1,
      privateRepos: true,
      aiInsights: true,
      architectureDiagrams: true,
      structuralDiff: true,
      refactorGuidance: true,
      testQuality: true,
      simulate: true,
      sbomExport: true,
      teamWorkspaces: false, // unimplemented — see TierLimits.teamWorkspaces
      prioritySupport: true,
      earlyAccess: true,
      apiAccess: true,
    },
    featureBullets: [
      "Everything in Plus",
      "Grade + watch on unlimited repos",
      "SBOM export (CycloneDX / SPDX)",
      "Priority support",
      "Early access + API (coming)",
    ],
    isRecommended: false,
  },
};

/** Ordered list for rendering — Free first, then up through Pro. */
export const TIER_ORDER: Tier[] = ["open-case", "standing-docket", "full-bench"];

/** Convenience helper for annual savings display. Returns absolute
 *  savings in USD when paying annually vs 12 × monthly. */
export function annualSavingsUsd(tier: TierConfig): number {
  if (tier.monthlyPriceUsd === 0) return 0;
  return tier.monthlyPriceUsd * 12 - tier.annualPriceUsd;
}

/** Convenience helper for annual savings percentage display. */
export function annualSavingsPercent(tier: TierConfig): number {
  if (tier.monthlyPriceUsd === 0) return 0;
  const fullYear = tier.monthlyPriceUsd * 12;
  return Math.round(((fullYear - tier.annualPriceUsd) / fullYear) * 100);
}

/** Format a price as a USD string. Uses $14.99 vs $39 conventions —
 *  cents only shown when non-zero so $39 reads cleaner than $39.00. */
export function formatPrice(usd: number): string {
  if (usd === 0) return "$0";
  if (Number.isInteger(usd)) return `$${usd}`;
  return `$${usd.toFixed(2)}`;
}

/** Resolve a tier config by id with type-safe defaulting to Open
 *  case for unknown / unauthenticated callers. Used by gating helpers. */
export function tierFor(tierId: Tier | null | undefined): TierConfig {
  if (!tierId) return TIER_CONFIG["open-case"];
  return TIER_CONFIG[tierId] ?? TIER_CONFIG["open-case"];
}
