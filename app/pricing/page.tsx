// Public pricing page — CodeTrawl "SURFACE & DEPTH" system.
//
// Wraps the route in CTSurface (the same shell + fonts + codetrawl.css as the
// landing) so /pricing reads as one brand. Keeps the real machinery: billing
// toggle (?billing=monthly|annual), Polar.sh checkout via CheckoutCTA, and the
// feature comparison grid. Tier definitions come from lib/pricing.ts so the
// page stays in sync with auth-gating + the Polar webhook handler.

import type { Metadata } from "next";
import { headers } from "next/headers";
import { Check } from "lucide-react";
import { auth } from "@/lib/auth";
import { CTSurface } from "@/components/landing/codetrawl/CTSurface";
import { CTNav } from "@/components/landing/codetrawl/CTNav";
import { CTFooter } from "@/components/landing/codetrawl/CTFooter";
import {
  TIER_CONFIG,
  TIER_ORDER,
  annualSavingsPercent,
  annualSavingsUsd,
  formatPrice,
} from "@/lib/pricing";
import { PricingBillingToggle } from "@/components/pricing/PricingBillingToggle";
import { CheckoutCTA } from "@/components/pricing/CheckoutCTA";

export const metadata: Metadata = {
  title: "Pricing — CodeTrawl",
  description:
    "The whole tool is free on one repo — private repos, AI briefing and Faultline change-simulation included. Upgrade to keep unlimited repos, a grade on every pull request, and regression watch — one deterministic sweep, computed not generated.",
};

export const dynamic = "force-dynamic";

export default async function PricingPage({
  searchParams,
}: {
  searchParams: Promise<{ billing?: "monthly" | "annual" }>;
}) {
  // Default to "annual" — the discount is the conversion hook, so the
  // first impression should be the lower per-month price.
  const sp = await searchParams;
  const initialBilling: "monthly" | "annual" =
    sp.billing === "monthly" ? "monthly" : "annual";

  const authSession = await auth.api.getSession({ headers: await headers() });
  const loggedIn = !!authSession?.user;

  return (
    <CTSurface>
      <CTNav />
      <main className="wrap price-page">
        <header className="price-hero">
          <span className="eyebrow">Pricing · the whole tool is free on one repo</span>
          <h1>Pick your depth.</h1>
          <p className="lede">
            Sweep any repo — public or private — with every panel unlocked,
            free. Upgrade to keep more than one repo on the go, put a grade on
            every pull request, and watch for regressions.
          </p>
        </header>

        <PricingBillingToggle initial={initialBilling} />

        <PricingCards billing={initialBilling} loggedIn={loggedIn} />

        <FeatureComparison />
      </main>
      <CTFooter />
    </CTSurface>
  );
}

// ─── Tier cards (styled via .ct .price-grid / .tier in codetrawl.css) ──────

function PricingCards({
  billing,
  loggedIn,
}: {
  billing: "monthly" | "annual";
  loggedIn: boolean;
}) {
  return (
    <div className="price-grid">
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
          <div
            className={`tier${tier.isRecommended ? " feat" : ""}`}
            key={tier.id}
          >
            {tier.isRecommended && <div className="ribbon">Recommended</div>}
            <div className="tname">{tier.name}</div>
            <div className="tsub">{tier.tagline}</div>

            <div className="price">
              {formatPrice(displayPrice)}
              {isPaid && <span className="per"> / mo</span>}
            </div>
            {showAnnualSavings ? (
              <span className="price-note save">
                Billed annually at {formatPrice(tier.annualPriceUsd)} · save{" "}
                {formatPrice(annualSavingsUsd(tier))} (
                {annualSavingsPercent(tier)}%)
              </span>
            ) : isPaid ? (
              <span className="price-note">Billed monthly</span>
            ) : (
              <span className="price-note">Forever free</span>
            )}

            <CheckoutCTA
              tierId={tier.id}
              billing={billing}
              isPaid={isPaid}
              isRecommended={tier.isRecommended}
              loggedIn={loggedIn}
            />

            <ul>
              {tier.featureBullets.map((bullet) => (
                <li key={bullet}>
                  <Check size={15} />
                  {bullet}
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

// ─── Feature comparison grid (reuses the .compare table styling) ───────────

function FeatureComparison() {
  // Free-phase: the whole analysis toolset is free (the top block, all ✓ on
  // Free). The paid axis is persistence + scale + recurring-cost monitoring
  // (the lower block). Mirrors the flags in lib/pricing.ts — keep in sync.
  const rows: Array<{ label: string; values: [boolean, boolean, boolean] }> = [
    { label: "Public repo analysis", values: [true, true, true] },
    { label: "Private repo analysis", values: [true, true, true] },
    { label: "AI Briefing + the read", values: [true, true, true] },
    { label: "Architecture diagrams", values: [true, true, true] },
    { label: "Structural diff between snapshots", values: [true, true, true] },
    { label: "Refactor guidance", values: [true, true, true] },
    { label: "Test-quality report", values: [true, true, true] },
    { label: "Faultline change-simulation", values: [true, true, true] },
    { label: "Unlimited saved repos", values: [false, true, true] },
    { label: "Unlimited refreshes", values: [false, true, true] },
    { label: "Grade watch on PRs", values: [false, true, true] },
    { label: "Unlimited PR repos", values: [false, false, true] },
    // "Team workspaces" used to sit here with a ✓ on Pro. There is no team,
    // org or membership model in the product, so the row was a promise nothing
    // could keep. Replaced with SBOM export, which is real (lib/sbom builds
    // CycloneDX + SPDX), is genuinely Pro-only, and was missing from this table
    // even though it shipped.
    { label: "SBOM export (CycloneDX / SPDX)", values: [false, false, true] },
    { label: "Priority support", values: [false, false, true] },
    { label: "Early access features", values: [false, false, true] },
  ];

  return (
    <section className="cmp">
      <div className="cmp-head">
        <span className="eyebrow">Every feature · plan by plan</span>
        <h2>Compare the plans.</h2>
      </div>
      {/* cmp-scroll makes the table scroll horizontally below 760px (where it
          gets min-width:640px) instead of being clipped by `.ct { overflow:
          clip }` — otherwise the right-hand tier columns are cut off on a
          phone right before the user decides to pay. */}
      <div
        className="compare cmp-scroll"
        tabIndex={0}
        role="region"
        aria-label="Plan comparison table"
      >
        <table>
          <thead>
            <tr>
              <th scope="col">
                <span className="sr-only">Feature</span>
              </th>
              {TIER_ORDER.map((id) => (
                <th scope="col" key={id}>
                  {TIER_CONFIG[id].name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label}>
                <th scope="row">{row.label}</th>
                {row.values.map((included, j) => (
                  <td key={j} className={included ? "yes" : "no"}>
                    {included ? (
                      "✓"
                    ) : (
                      <>
                        <span aria-hidden>—</span>
                        <span className="sr-only">no</span>
                      </>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
