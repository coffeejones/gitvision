// Public pricing page — restyled to forensic-dossier in Phase M.
//
// Wraps the whole route in RJSurface (the shared records-office shell)
// so /pricing reads as one brand with the landing + auth. Keeps the
// real machinery: billing toggle (?billing=monthly|annual), Polar.sh
// checkout via CheckoutCTA, and the feature comparison grid. Tier
// definitions come from lib/pricing.ts so the page stays in sync with
// auth-gating + the Polar webhook handler.

import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { Check } from "lucide-react";
import { auth } from "@/lib/auth";
import { RJSurface } from "@/components/landing/repojury/RJSurface";
import { CrestSeal } from "@/components/landing/repojury/seals";
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
  title: "Pricing — RepoJury",
  description:
    "Three ways to retain the jury. Open your first case free, then upgrade for unlimited private repos, the verdict on every PR, and team access.",
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
    <RJSurface>
      <PricingNav loggedIn={loggedIn} />
      <main className="wrap price-page spot">
        <header className="price-hero">
          <span className="eyebrow">Pricing · open your first case free</span>
          <h1>Retain the jury.</h1>
          <p className="lede">
            Put any public repo on trial for free. Upgrade when you need
            unlimited private cases, the verdict on every pull request, or
            the whole bench for your team.
          </p>
        </header>

        <PricingBillingToggle initial={initialBilling} />

        <PricingCards billing={initialBilling} loggedIn={loggedIn} />

        <FeatureComparison />
      </main>
      <PricingFooter />
    </RJSurface>
  );
}

// ─── Minimal nav — links back to the landing's sections (absolute anchors) ─

function PricingNav({ loggedIn }: { loggedIn: boolean }) {
  return (
    <nav>
      <Link href="/" className="brand">
        <CrestSeal className="seal-sm" />
        <span>
          <b style={{ fontWeight: 700 }}>Repo</b>Jury
        </span>
      </Link>
      <div className="nav-links">
        <Link href="/#process">How it works</Link>
        <Link href="/#custody">Chain of custody</Link>
        <Link href="/pricing">Pricing</Link>
      </div>
      <div className="nav-right">
        {!loggedIn && (
          <Link href="/login" className="btn btn-ghost">
            Sign in
          </Link>
        )}
        <Link href="/signup" className="btn btn-primary">
          Open a case
        </Link>
      </div>
    </nav>
  );
}

// ─── Tier cards (reuses the landing's .price-grid / .tier) ────────────

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
              <span className="price-note muted">Billed monthly</span>
            ) : (
              <span className="price-note muted">Forever free</span>
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

// ─── Feature comparison grid ──────────────────────────────────────────

function FeatureComparison() {
  const rows: Array<{ label: string; values: [boolean, boolean, boolean] }> = [
    { label: "Public repo analysis", values: [true, true, true] },
    { label: "Private repo analysis", values: [false, true, true] },
    { label: "Saved cases", values: [false, true, true] },
    { label: "Unlimited refreshes", values: [false, true, true] },
    { label: "AI Briefing + bench statement", values: [false, true, true] },
    { label: "Architecture diagrams", values: [false, true, true] },
    { label: "Structural diff between snapshots", values: [false, true, true] },
    { label: "Verdict watch on PRs", values: [false, true, true] },
    { label: "Unlimited PR repos", values: [false, false, true] },
    { label: "Team workspaces", values: [false, false, true] },
    { label: "Priority support", values: [false, false, true] },
    { label: "Early access features", values: [false, false, true] },
  ];

  return (
    <section className="cmp">
      <div className="cmp-head sec-head">
        <span className="eyebrow">The full docket · feature by feature</span>
        <h2 className="display">Compare the bench.</h2>
      </div>
      <table>
        <thead>
          <tr>
            <th>Feature</th>
            {TIER_ORDER.map((id) => (
              <th key={id}>{TIER_CONFIG[id].name}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label}>
              <td>{row.label}</td>
              {row.values.map((included, j) => (
                <td key={j} className={included ? "yes" : "no"}>
                  {included ? "✓" : "—"}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

// ─── Footer (mirrors the landing's) ───────────────────────────────────

function PricingFooter() {
  return (
    <footer>
      <div className="wrap foot">
        <Link href="/" className="brand">
          <CrestSeal className="seal-sm" />
          <span>
            <b style={{ fontWeight: 700 }}>Repo</b>Jury
          </span>
        </Link>
        <div className="foot-links">
          <Link href="/">Home</Link>
          <Link href="/pricing">Pricing</Link>
          <Link href="/login">Sign in</Link>
        </div>
        <span className="copy">© 2026 RepoJury</span>
      </div>
      <div className="wrap foot-legal">
        <Link href="/privacy">Privacy</Link>
        <Link href="/terms">Terms</Link>
        <Link href="/cookies">Cookies</Link>
        <Link href="/refunds">Refunds</Link>
      </div>
    </footer>
  );
}
