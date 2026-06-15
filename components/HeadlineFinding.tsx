// Above-the-fold headline finding for the session Overview page (v0.57 / A1).
//
// The 30-second rule from r/devtools alpha feedback: if a visitor can't see
// the impact of the tool in 30 seconds, they bounce. The hero section gives
// identity and stats, but stats don't tell visitors what to DO. This panel
// picks one concrete actionable signal — the worst thing or the most
// interesting thing about this repo — and surfaces it loudly with a CTA
// straight to the relevant tab.
//
// Logic lives in lib/intelligence/headline.ts (pure pickHeadline()).
// This component is a thin renderer: severity-coded gradient, icon block,
// primary + detail copy, optional CTA link.
//
// Visual language matches SinceLastVisit (gradient hero, icon block, eyebrow)
// so the two banners read as a coherent "above the fold" zone — first the
// "what changed since last time", then the "what matters most right now".

import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  Info,
  ShieldAlert,
  Sparkles,
} from "lucide-react";
import type { Headline, HeadlineSeverity } from "@/lib/intelligence/headline";
import { STYLE, TOK } from "@/lib/sessionTheme";

interface SeverityStyle {
  /** Color of the icon + accent. */
  fg: string;
  /** Soft tint for the icon-block background. */
  bg: string;
  /** Border + ring color (typically `${fg}33` for 20% alpha). */
  ring: string;
  /** Eyebrow label shown above the headline. */
  eyebrow: string;
  /** Icon component for the icon-block. */
  Icon: React.ComponentType<{ size?: number }>;
}

const SEVERITY_STYLES: Record<HeadlineSeverity, SeverityStyle> = {
  critical: {
    fg: TOK.rose,
    bg: TOK.roseSoft,
    ring: `${TOK.rose}44`,
    eyebrow: "Top finding · needs attention",
    Icon: ShieldAlert,
  },
  warning: {
    fg: TOK.amber,
    bg: TOK.amberSoft,
    ring: `${TOK.amber}44`,
    eyebrow: "Top finding",
    Icon: AlertTriangle,
  },
  info: {
    fg: TOK.accent,
    bg: TOK.accentSoft,
    ring: `${TOK.accent}44`,
    eyebrow: "Top finding",
    Icon: Sparkles,
  },
};

/** Special-case the "no-data" / "stale-repo" / "generic-healthy" headlines —
 *  these aren't really "findings", more like "current state". A neutral icon
 *  reads better than the celebratory Sparkles. */
function pickSeverityStyle(headline: Headline): SeverityStyle {
  const base = SEVERITY_STYLES[headline.severity];
  if (headline.kind === "no-data" || headline.kind === "stale-repo") {
    return { ...base, Icon: Info, eyebrow: "Repo status" };
  }
  if (headline.kind === "generic-healthy") {
    return { ...base, eyebrow: "Repo overview" };
  }
  return base;
}

interface Props {
  headline: Headline;
  /** Session id — used to build absolute /session/{id}/<ctaLink> URLs. */
  sessionId: string;
}

export function HeadlineFinding({ headline, sessionId }: Props) {
  const style = pickSeverityStyle(headline);
  const { Icon } = style;
  // Fragment-only ctaLinks (like "#secrets") stay on the current page
  // and scroll to a panel anchor; everything else builds a nested
  // tab URL. Without this branch, "#secrets" would resolve to
  // "/session/{id}/#secrets" which is fine technically but skips the
  // smart-scroll behavior of same-page hash navigation in App Router.
  const href = headline.ctaLink
    ? headline.ctaLink.startsWith("#")
      ? headline.ctaLink
      : `/session/${sessionId}/${headline.ctaLink}`
    : null;

  // The whole card becomes a hover-highlighted Link when there's a CTA.
  // Otherwise plain div — no false affordance.
  const Body = (
    <>
      <div className="flex items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-2">
          <span
            className="h-6 w-6 rounded-lg flex items-center justify-center"
            style={{
              background: style.bg,
              color: style.fg,
              border: `1px solid ${style.ring}`,
            }}
          >
            <Icon size={11} />
          </span>
          <span className={STYLE.eyebrow} style={{ color: TOK.textMuted }}>
            {style.eyebrow}
          </span>
        </div>
        {headline.ctaLabel && href && (
          <span
            className="inline-flex items-center gap-1 font-mono"
            style={{ color: style.fg }}
          >
            {headline.ctaLabel}
            <ArrowRight size={11} />
          </span>
        )}
      </div>

      <div className="flex items-start gap-4">
        <span
          className="h-11 w-11 rounded-xl flex items-center justify-center shrink-0 mt-0.5"
          style={{
            background: style.bg,
            color: style.fg,
            border: `1px solid ${style.ring}`,
          }}
        >
          <Icon size={22} />
        </span>
        <div className="flex-1 min-w-0 pt-0.5">
          <div
            className="text-xl font-semibold leading-tight tracking-tight"
            style={{ color: TOK.textPrimary }}
          >
            {headline.primary}
          </div>
          <div
            className="text-sm mt-1.5 leading-relaxed"
            style={{ color: TOK.textSecondary }}
          >
            {headline.detail}
          </div>
        </div>
      </div>
    </>
  );

  const containerClass =
    "rounded-xl p-6 flex flex-col gap-5 transition" +
    (href ? " group hover:brightness-110" : "");
  // Severity-tinted gradient + the same 1px ambient + lift shadow
  // recipe as the rest of the page's material cards. The severity
  // gradient does the colour; the shadow stack does the depth.
  const containerStyle = {
    background: `linear-gradient(135deg, ${style.bg} 0%, transparent 55%), ${TOK.surface}`,
    border: `1px solid ${style.ring}`,
  };

  if (href) {
    return (
      <Link href={href} className={containerClass} style={containerStyle}>
        {Body}
      </Link>
    );
  }
  return (
    <div className={containerClass} style={containerStyle}>
      {Body}
    </div>
  );
}
