// Reusable upgrade prompt for locked features.
//
// Renders inside a route where the user has navigated to a feature
// their current tier doesn't unlock — e.g. Open case user opens
// /session/{id}/insights, sees this prompt instead of AI Briefing.
//
// Visual language: same material card recipe as everything else
// post-D4 polish, with the TierIcon of the required tier as the
// visual anchor. The CTA primary is "See pricing" linking to
// /pricing; secondary action is "I'm already on X — refresh" for
// users whose subscription may have just kicked in but session
// state hasn't caught up.
//
// Tone: NOT "you're locked out". Instead "here's what you'd unlock"
// — the message is value-led, not punishment-led.

import Link from "next/link";
import { ArrowRight, Lock, Sparkles } from "lucide-react";
import { TOK } from "@/lib/sessionTheme";
import { TierIcon, type Tier } from "@/components/TierIcon";
import { TIER_CONFIG, formatPrice } from "@/lib/pricing";

interface Props {
  /** What the user tried to access — appears in the headline. */
  featureName: string;
  /** Lowest tier that unlocks this feature. */
  requiredTier: Exclude<Tier, "open-case">;
  /** Optional sub-feature bullets that tease what's behind the lock.
   *  Default: pulls the required tier's feature bullets from
   *  TIER_CONFIG so we don't have to duplicate the list. */
  unlockedFeatures?: string[];
  /** Optional context paragraph above the headline. */
  context?: string;
}

export function UpgradePrompt({
  featureName,
  requiredTier,
  unlockedFeatures,
  context,
}: Props) {
  const tier = TIER_CONFIG[requiredTier];
  const bullets = unlockedFeatures ?? tier.featureBullets.slice(0, 5);

  return (
    <section
      className="rounded-xl p-8 flex flex-col gap-6 max-w-2xl mx-auto"
      style={{
        background: `linear-gradient(135deg, ${TOK.surfaceElevated} 0%, ${TOK.surface} 60%)`,
        border: `1px solid ${TOK.border}`,
        boxShadow:
          "0 1px 2px rgba(0, 0, 0, 0.15), 0 8px 24px -12px rgba(0, 0, 0, 0.35)",
      }}
    >
      {/* Header — lock icon + tier label */}
      <header className="flex items-start gap-4">
        <div
          className="rounded-lg p-3 flex items-center justify-center flex-shrink-0"
          style={{
            background: "rgba(255, 255, 255, 0.04)",
            border: `1px solid ${TOK.border}`,
          }}
        >
          <Lock size={20} style={{ color: TOK.textMuted }} />
        </div>
        <div className="flex flex-col gap-1 flex-1 min-w-0">
          <span
            className="text-[10px] uppercase tracking-[0.18em] font-medium"
            style={{ color: TOK.textMuted }}
          >
            {tier.name} feature
          </span>
          {context && (
            <p
              className="text-sm leading-relaxed"
              style={{ color: TOK.textMuted }}
            >
              {context}
            </p>
          )}
          <h2
            className="text-2xl font-semibold tracking-tight"
            style={{
              color: TOK.textPrimary,
              letterSpacing: "-0.02em",
              lineHeight: 1.15,
            }}
          >
            Unlock {featureName} with {tier.name}.
          </h2>
        </div>
      </header>

      {/* What you'd unlock — tier feature bullets */}
      <div
        className="rounded-lg p-4 flex flex-col gap-3"
        style={{
          background: "rgba(255, 255, 255, 0.02)",
          border: `1px solid ${TOK.border}`,
        }}
      >
        <div className="flex items-center gap-2">
          <TierIcon tier={tier.id} size={18} />
          <span
            className="text-sm font-medium"
            style={{ color: TOK.textPrimary }}
          >
            {tier.name} — {formatPrice(tier.monthlyPriceUsd)}/mo or{" "}
            {formatPrice(tier.annualPriceUsd)}/year
          </span>
        </div>
        <ul className="flex flex-col gap-2 mt-1">
          {bullets.map((bullet, i) => (
            <li
              key={i}
              className="flex items-start gap-2.5 text-sm"
              style={{ color: TOK.textSecondary }}
            >
              <Sparkles
                size={12}
                strokeWidth={2}
                style={{
                  color: TOK.accent,
                  marginTop: 5,
                  flexShrink: 0,
                }}
              />
              <span>{bullet}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* CTAs */}
      <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center">
        <Link
          href="/pricing"
          className="inline-flex items-center justify-center gap-2 h-11 px-5 rounded-lg text-sm font-medium transition hover:opacity-90"
          style={{
            background: TOK.textPrimary,
            color: TOK.bg,
          }}
        >
          See plans
          <ArrowRight size={14} />
        </Link>
        <Link
          href="/account/billing"
          className="inline-flex items-center justify-center h-11 px-5 rounded-lg text-sm font-medium transition hover:bg-white/5"
          style={{
            color: TOK.textSecondary,
            border: `1px solid rgba(255, 255, 255, 0.1)`,
          }}
        >
          I&apos;m already on {tier.name}
        </Link>
      </div>
    </section>
  );
}
