// Upgrade nudge on the Surveys home — shown only to free accounts (the page
// passes showUpgrade). A calmer, higher-surface complement to the sidebar
// "Upgrade" link: the Plus tagline + the top benefits + a price'd CTA to
// /pricing. Pulls everything from lib/pricing so it stays the source of truth.

import Link from "next/link";
import { ArrowUpCircle, Check } from "lucide-react";
import { CH, CH_FOCUS } from "./theme";
import { TIER_CONFIG } from "@/lib/pricing";

export function UpgradeCard() {
  const plus = TIER_CONFIG["standing-docket"];
  const bullets = plus.featureBullets.slice(0, 4);

  return (
    <section
      className="mb-7 rounded-xl p-5 sm:p-6"
      style={{ background: CH.panel, border: `1px solid ${CH.border}` }}
      aria-label={`Upgrade to ${plus.name}`}
    >
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <div
            className="text-[10px] font-semibold uppercase tracking-[0.14em]"
            style={{ color: CH.textMuted }}
          >
            You&rsquo;re on Free
          </div>
          <h2
            className="mt-1.5 text-[19px] font-semibold tracking-tight"
            style={{ color: CH.text, letterSpacing: "-0.02em" }}
          >
            Go deeper with {plus.name}
          </h2>
          <p className="mt-1 text-[13.5px]" style={{ color: CH.textDim }}>
            {plus.tagline}
          </p>
        </div>
        <Link
          href="/pricing"
          className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg px-4 py-2 text-[13px] font-semibold transition-all hover:-translate-y-px ${CH_FOCUS}`}
          style={{ background: CH.accent, color: CH.accentText }}
        >
          <ArrowUpCircle size={14} />
          See plans · ${plus.monthlyPriceUsd}/mo
        </Link>
      </div>
      <ul className="mt-4 grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
        {bullets.map((b) => (
          <li
            key={b}
            className="flex items-start gap-2 text-[13px]"
            style={{ color: CH.textDim }}
          >
            <Check
              size={14}
              style={{ color: CH.accent, marginTop: 2, flexShrink: 0 }}
              aria-hidden
            />
            <span>{b}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
