// Public pricing page — three-tier comparison with Polar.sh checkout
// integration (wired up in P3). Renders the same hero pattern as the
// rest of the marketing surfaces (editorial eyebrow + h1 + subtitle)
// and uses the established design-system: material gradient cards,
// TierIcon, white-on-dark CTAs.
//
// Reads tier definitions from lib/pricing.ts so the page stays in
// sync with auth-gating + Polar webhook handler.

import type { Metadata } from "next";
import { headers } from "next/headers";
import { Check, X } from "lucide-react";
import { auth } from "@/lib/auth";
import { MarketingNav } from "@/components/MarketingNav";
import { TierIcon } from "@/components/TierIcon";
import { TOK } from "@/lib/theme";
import {
  TIER_CONFIG,
  TIER_ORDER,
  TRIAL_DAYS,
  annualSavingsPercent,
  annualSavingsUsd,
  formatPrice,
} from "@/lib/pricing";
import { PricingBillingToggle } from "@/components/pricing/PricingBillingToggle";
import { CheckoutCTA } from "@/components/pricing/CheckoutCTA";

export const metadata: Metadata = {
  title: "Pricing — RepoBaron",
  description:
    "Three tiers built for the spectrum of code work. Try Knight or Baron free for 14 days, no card required.",
};

export const dynamic = "force-dynamic";

export default async function PricingPage({
  searchParams,
}: {
  searchParams: Promise<{ billing?: "monthly" | "annual" }>;
}) {
  // Next.js 16: searchParams is a Promise; await server-side so the
  // initial paint already has the right billing-mode picked.
  // Default to "annual" because the discount is the conversion hook
  // — first impression on /pricing should be the lower per-month
  // price, not the full-monthly anchor.
  const sp = await searchParams;
  const initialBilling: "monthly" | "annual" =
    sp.billing === "monthly" ? "monthly" : "annual";

  // Read auth state server-side so the CheckoutCTA knows whether to
  // POST directly to /api/billing/checkout (logged-in) or redirect to
  // /signup with intent preserved (logged-out). Avoids a flash of the
  // wrong CTA-state on hydration.
  const authSession = await auth.api.getSession({
    headers: await headers(),
  });
  const loggedIn = !!authSession?.user;

  return (
    <div
      className="min-h-screen w-full"
      style={{
        backgroundColor: TOK.bg,
        backgroundImage: `
          linear-gradient(225deg, rgba(255,255,255,0.08) 0%, transparent 55%),
          linear-gradient(45deg, rgba(0,0,0,0.35) 0%, transparent 55%)
        `,
        backgroundAttachment: "fixed, fixed",
      }}
    >
      <MarketingNav />
      <main className="max-w-7xl w-full mx-auto px-6 sm:px-10 lg:px-12 pt-16 pb-24 flex flex-col gap-16">
        {/* Editorial hero — matches the rest of the marketing pages */}
        <header className="flex flex-col gap-5 items-center text-center">
          <span
            className="text-[10px] uppercase tracking-[0.18em] font-medium"
            style={{ color: TOK.textMuted }}
          >
            Pricing
          </span>
          <h1
            className="text-4xl sm:text-5xl font-semibold tracking-tight max-w-3xl"
            style={{
              color: TOK.textPrimary,
              letterSpacing: "-0.025em",
              lineHeight: 1.05,
            }}
          >
            One signal layer, three ways to use it.
          </h1>
          <p
            className="text-base sm:text-lg max-w-2xl leading-relaxed"
            style={{ color: TOK.textSecondary }}
          >
            Start free on any public repo. Upgrade when you need
            unlimited sessions, AI Insights, or the PR-bot for your
            team. {TRIAL_DAYS}-day trial on paid tiers — no card up
            front.
          </p>
        </header>

        {/* Monthly/annual toggle (client island for interactivity) */}
        <div className="flex justify-center">
          <PricingBillingToggle initial={initialBilling} />
        </div>

        <PricingCards billing={initialBilling} loggedIn={loggedIn} />

        <FeatureComparisonTable />
      </main>
    </div>
  );
}

function PricingCards({
  billing,
  loggedIn,
}: {
  billing: "monthly" | "annual";
  loggedIn: boolean;
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
      {TIER_ORDER.map((tierId) => {
        const tier = TIER_CONFIG[tierId];
        const isPaid = tier.monthlyPriceUsd > 0;
        const displayPrice = isPaid
          ? billing === "annual"
            ? tier.annualPriceUsd / 12
            : tier.monthlyPriceUsd
          : 0;
        const showAnnualSavings = isPaid && billing === "annual";

        return (
          <article
            key={tier.id}
            className="rounded-xl p-6 flex flex-col gap-5 relative"
            style={{
              background: `linear-gradient(135deg, ${TOK.surfaceElevated} 0%, ${TOK.surface} 60%)`,
              border: `1px solid ${
                tier.isRecommended ? TOK.borderStrong : TOK.border
              }`,
              boxShadow:
                "0 1px 2px rgba(0, 0, 0, 0.15), 0 8px 24px -12px rgba(0, 0, 0, 0.35)",
            }}
          >
            {/* Recommended ribbon */}
            {tier.isRecommended && (
              <span
                className="absolute -top-3 left-6 text-[10px] uppercase tracking-[0.18em] font-medium px-2 py-0.5 rounded"
                style={{
                  background: TOK.textPrimary,
                  color: TOK.bg,
                }}
              >
                Recommended
              </span>
            )}

            {/* Tier identity */}
            <div className="flex items-center gap-3">
              <TierIcon tier={tier.id} size={36} />
              <div className="flex flex-col">
                <h2
                  className="text-xl font-semibold tracking-tight"
                  style={{
                    color: TOK.textPrimary,
                    letterSpacing: "-0.015em",
                  }}
                >
                  {tier.name}
                </h2>
              </div>
            </div>

            <p
              className="text-sm leading-relaxed"
              style={{ color: TOK.textSecondary }}
            >
              {tier.tagline}
            </p>

            {/* Price */}
            <div className="flex flex-col gap-1.5">
              <div className="flex items-baseline gap-2">
                <span
                  className="text-4xl font-semibold tabular-nums tracking-tight"
                  style={{
                    color: TOK.textPrimary,
                    letterSpacing: "-0.025em",
                  }}
                >
                  {formatPrice(displayPrice)}
                </span>
                {isPaid && (
                  <span
                    className="text-sm"
                    style={{ color: TOK.textMuted }}
                  >
                    /mo
                  </span>
                )}
              </div>
              {showAnnualSavings && (
                <span
                  className="text-[11px]"
                  style={{ color: TOK.accent }}
                >
                  Billed annually at {formatPrice(tier.annualPriceUsd)} ·
                  save {formatPrice(annualSavingsUsd(tier))} (
                  {annualSavingsPercent(tier)}%)
                </span>
              )}
              {!showAnnualSavings && isPaid && (
                <span
                  className="text-[11px]"
                  style={{ color: TOK.textMuted }}
                >
                  Billed monthly
                </span>
              )}
              {!isPaid && (
                <span
                  className="text-[11px]"
                  style={{ color: TOK.textMuted }}
                >
                  Forever free
                </span>
              )}
            </div>

            {/* CTA */}
            <CheckoutCTA
              tierId={tier.id}
              billing={billing}
              isPaid={isPaid}
              isRecommended={tier.isRecommended}
              loggedIn={loggedIn}
              trialDays={TRIAL_DAYS}
            />

            {/* Feature bullets */}
            <ul className="flex flex-col gap-2.5 mt-2">
              {tier.featureBullets.map((bullet, i) => (
                <li
                  key={i}
                  className="flex items-start gap-2.5 text-sm"
                  style={{ color: TOK.textSecondary }}
                >
                  <Check
                    size={14}
                    strokeWidth={2}
                    style={{
                      color: TOK.accent,
                      marginTop: 4,
                      flexShrink: 0,
                    }}
                  />
                  <span>{bullet}</span>
                </li>
              ))}
            </ul>
          </article>
        );
      })}
    </div>
  );
}

// Feature comparison table — shown below cards for users who want
// the full grid view. Apple-style: clean borders, single accent for
// "included" rows, em-dash for "not included" (less visually loud
// than X icons).

function FeatureComparisonTable() {
  const rows: Array<{ label: string; values: [boolean, boolean, boolean] }> = [
    {
      label: "Public repo analysis",
      values: [true, true, true],
    },
    {
      label: "Private repo analysis",
      values: [false, true, true],
    },
    {
      label: "Saved sessions",
      values: [false, true, true],
    },
    {
      label: "Unlimited refreshes",
      values: [false, true, true],
    },
    {
      label: "AI Briefing + Health Check",
      values: [false, true, true],
    },
    {
      label: "Architecture diagrams",
      values: [false, true, true],
    },
    {
      label: "Structural diff between snapshots",
      values: [false, true, true],
    },
    {
      label: "PR-bot installation",
      values: [false, true, true],
    },
    {
      label: "Unlimited PR-bot repos",
      values: [false, false, true],
    },
    {
      label: "Team workspaces",
      values: [false, false, true],
    },
    {
      label: "Priority support",
      values: [false, false, true],
    },
    {
      label: "Early access features",
      values: [false, false, true],
    },
  ];

  return (
    <section className="flex flex-col gap-6">
      <h2
        className="text-2xl sm:text-3xl font-semibold tracking-tight text-center"
        style={{
          color: TOK.textPrimary,
          letterSpacing: "-0.02em",
        }}
      >
        Compare features
      </h2>
      <div
        className="rounded-xl overflow-hidden"
        style={{
          background: `linear-gradient(135deg, ${TOK.surfaceElevated} 0%, ${TOK.surface} 60%)`,
          border: `1px solid ${TOK.border}`,
          boxShadow:
            "0 1px 2px rgba(0, 0, 0, 0.15), 0 8px 24px -12px rgba(0, 0, 0, 0.35)",
        }}
      >
        {/* Table header */}
        <div
          className="grid grid-cols-[1.5fr_repeat(3,1fr)] gap-4 px-5 py-4 border-b"
          style={{ borderColor: TOK.border }}
        >
          <div
            className="text-[10px] uppercase tracking-[0.18em] font-medium"
            style={{ color: TOK.textMuted }}
          >
            Feature
          </div>
          {TIER_ORDER.map((tierId) => {
            const tier = TIER_CONFIG[tierId];
            return (
              <div
                key={tier.id}
                className="flex items-center justify-center gap-2"
              >
                <TierIcon tier={tier.id} size={16} />
                <span
                  className="text-sm font-medium"
                  style={{ color: TOK.textPrimary }}
                >
                  {tier.name}
                </span>
              </div>
            );
          })}
        </div>

        {/* Table rows */}
        {rows.map((row, i) => (
          <div
            key={i}
            className="grid grid-cols-[1.5fr_repeat(3,1fr)] gap-4 px-5 py-3 items-center"
            style={{
              borderBottom:
                i < rows.length - 1 ? `1px solid ${TOK.border}` : undefined,
            }}
          >
            <div className="text-sm" style={{ color: TOK.textSecondary }}>
              {row.label}
            </div>
            {row.values.map((included, j) => (
              <div key={j} className="flex justify-center">
                {included ? (
                  <Check
                    size={16}
                    strokeWidth={2.5}
                    style={{ color: TOK.accent }}
                  />
                ) : (
                  <X
                    size={14}
                    strokeWidth={2}
                    style={{ color: TOK.textMuted, opacity: 0.4 }}
                  />
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}
