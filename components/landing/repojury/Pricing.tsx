// Pricing — case-flavored tiers backed by lib/pricing.ts so the
// landing always shows the same numbers + features as /pricing and
// /account/billing. Single source of truth: change TIER_CONFIG, the
// landing updates next deploy without a separate edit.
//
// Server component (no "use client") — the TIER_CONFIG import is
// safe to evaluate at render time.

import { Reveal } from "../Reveal";
import {
  TIER_CONFIG,
  TIER_ORDER,
  formatPrice,
  type TierConfig,
} from "@/lib/pricing";

function Check() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden
    >
      <path d="M3 8l3.5 3.5L13 5" />
    </svg>
  );
}

/** CTA copy for each tier — case-flavored, distinct from the
 *  TIER_CONFIG.name. Keyed by tier id so the lookup is type-safe. */
const TIER_CTAS: Record<TierConfig["id"], string> = {
  "open-case": "Open a case",
  "standing-docket": "Start standing docket",
  "full-bench": "Convene full bench",
};

export function Pricing() {
  return (
    <section className="section-pad spot brass" id="pricing">
      <div className="wrap">
        <Reveal className="sec-head">
          <span className="eyebrow">Pricing · open your first case free</span>
          <h2 className="display">Retain the jury.</h2>
        </Reveal>
        <Reveal className="price-grid">
          {TIER_ORDER.map((id) => {
            const tier = TIER_CONFIG[id];
            const featured = tier.isRecommended;
            return (
              <div className={`tier${featured ? " feat" : ""}`} key={tier.id}>
                {featured && (
                  <div className="feat-badge">★ {tier.name}</div>
                )}
                <div className="tname">{tier.name}</div>
                <div className="tsub">{tier.tagline}</div>
                <div className="price">
                  {formatPrice(tier.monthlyPriceUsd)}
                  {tier.monthlyPriceUsd > 0 && <span> / mo</span>}
                </div>
                <ul>
                  {tier.featureBullets.map((f) => (
                    <li key={f}>
                      <Check />
                      {f}
                    </li>
                  ))}
                </ul>
                <a
                  href="#"
                  className={`btn ${featured ? "btn-primary" : "btn-ghost"}`}
                  style={{ justifyContent: "center" }}
                >
                  {TIER_CTAS[tier.id]}
                </a>
              </div>
            );
          })}
        </Reveal>
      </div>
    </section>
  );
}
