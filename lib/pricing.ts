// Central pricing configuration for RepoBaron tiers (v0.78).
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
// To add a new tier (e.g. "Earl" or "Duke"):
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
  /** Allow private GitHub repos for analysis */
  privateRepos: boolean;
  /** AI Briefing + Health Check unlocked */
  aiInsights: boolean;
  /** Architecture (class diagrams) tab unlocked */
  architectureDiagrams: boolean;
  /** Structural diff between snapshots */
  structuralDiff: boolean;
  /** Team workspaces (multi-user) */
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

/** Trial period for paid tiers, in days. No card up front during trial. */
export const TRIAL_DAYS = 14;

export const TIER_CONFIG: Record<Tier, TierConfig> = {
  scout: {
    id: "scout",
    name: "Scout",
    tagline: "Try it on a public repo. No card required.",
    monthlyPriceUsd: 0,
    annualPriceUsd: 0,
    polarProductIdMonthly: "",
    polarProductIdAnnual: "",
    limits: {
      savedSessions: 1,
      refreshesPerDay: 5,
      prBotRepos: 0,
      privateRepos: false,
      aiInsights: false,
      architectureDiagrams: false,
      structuralDiff: false,
      teamWorkspaces: false,
      prioritySupport: false,
      earlyAccess: false,
      apiAccess: false,
    },
    featureBullets: [
      "1 saved session at a time",
      "Public repos only",
      "5 refreshes per day",
      "Canvas, Code, Packages, Imports, PRs",
      "Deterministic Health Summary (17 signals)",
      "Browse all demo repos",
    ],
    isRecommended: false,
  },
  knight: {
    id: "knight",
    name: "Knight",
    tagline: "Capable analysis for serious work.",
    monthlyPriceUsd: 14.99,
    annualPriceUsd: 149.99,
    polarProductIdMonthly: "e4a98280-2920-41b9-af24-f713841b22f6",
    polarProductIdAnnual: "4ebaff71-30bb-46da-ba0a-a8df457fd277",
    limits: {
      savedSessions: -1,
      refreshesPerDay: -1,
      prBotRepos: 5,
      privateRepos: true,
      aiInsights: true,
      architectureDiagrams: true,
      structuralDiff: true,
      teamWorkspaces: false,
      prioritySupport: false,
      earlyAccess: false,
      apiAccess: false,
    },
    featureBullets: [
      "Unlimited saved sessions",
      "Public + private repos",
      "Unlimited refreshes",
      "AI Briefing + Health Check verdict",
      "Architecture diagrams (auto class extraction)",
      "Structural diff between snapshots",
      "PR-bot on 5 repos",
    ],
    isRecommended: true,
  },
  baron: {
    id: "baron",
    name: "Baron",
    tagline: "Master every repo you touch.",
    monthlyPriceUsd: 39,
    annualPriceUsd: 390,
    polarProductIdMonthly: "feabdb6f-55e1-4e3a-94a5-bd0c3ae609a3",
    polarProductIdAnnual: "424ec832-e69b-49f0-8eda-417fc845a909",
    limits: {
      savedSessions: -1,
      refreshesPerDay: -1,
      prBotRepos: -1,
      privateRepos: true,
      aiInsights: true,
      architectureDiagrams: true,
      structuralDiff: true,
      teamWorkspaces: true,
      prioritySupport: true,
      earlyAccess: true,
      apiAccess: true,
    },
    featureBullets: [
      "Everything in Knight",
      "PR-bot on unlimited repos",
      "Team workspaces (multi-user)",
      "Priority support",
      "Early access to new features",
      "API access (coming)",
    ],
    isRecommended: false,
  },
};

/** Ordered list for rendering — Scout first, then up through Baron. */
export const TIER_ORDER: Tier[] = ["scout", "knight", "baron"];

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

/** Resolve a tier config by id with type-safe defaulting to Scout
 *  for unknown / unauthenticated callers. Used by gating helpers. */
export function tierFor(tierId: Tier | null | undefined): TierConfig {
  if (!tierId) return TIER_CONFIG.scout;
  return TIER_CONFIG[tierId] ?? TIER_CONFIG.scout;
}
