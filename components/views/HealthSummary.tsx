// Traffic-light health summary panel for the Overview (v0.59 / A3).
//
// Six tiles, one per dimension, color-coded by status. Each tile is a
// Link to /session/{id}/insights so visitors can drill in for evidence
// and AI prose. The grid is responsive: 6 columns on desktop, 3 on
// tablet, 2 on mobile — keeps the strip scannable at any width without
// truncating tile text.
//
// Logic lives in lib/intelligence/healthSummary.ts. This component is a
// thin renderer with explicit color tokens per status, so the trust
// chain stays: each color maps to a deterministic signal status, every
// tile drills into the page where the signals (and their evidence) live.

import Link from "next/link";
import { ArrowRight, AlertCircle, Check, Minus, User } from "lucide-react";
import type {
  DimensionStatus,
  DimensionSummary,
} from "@/lib/intelligence/healthSummary";
import { STYLE, TOK } from "@/lib/theme";

interface StatusStyle {
  /** Foreground color of the icon + status label. */
  fg: string;
  /** Soft tile background tint. */
  bg: string;
  /** Tile border. */
  border: string;
  /** Icon component for the status dot. */
  Icon: React.ComponentType<{ size?: number }>;
}

const STATUS_STYLES: Record<DimensionStatus, StatusStyle> = {
  critical: {
    fg: TOK.rose,
    bg: TOK.roseSoft,
    border: `${TOK.rose}33`,
    Icon: AlertCircle,
  },
  warning: {
    fg: TOK.amber,
    bg: TOK.amberSoft,
    border: `${TOK.amber}33`,
    Icon: AlertCircle,
  },
  healthy: {
    fg: TOK.accent,
    bg: TOK.accentSoft,
    border: `${TOK.accent}33`,
    Icon: Check,
  },
  solo: {
    fg: TOK.textSecondary,
    bg: TOK.surfaceElevated,
    border: TOK.border,
    Icon: User,
  },
  unknown: {
    fg: TOK.textMuted,
    bg: TOK.surfaceElevated,
    border: TOK.border,
    Icon: Minus,
  },
};

interface Props {
  summaries: DimensionSummary[];
  /** Session id — used to build the /session/{id}/insights link. */
  sessionId: string;
}

export function HealthSummary({ summaries, sessionId }: Props) {
  // Hide entirely if every dimension is unknown. Means we have no data to
  // talk about — quick-look-cards already say "refresh to populate".
  if (summaries.every((d) => d.status === "unknown")) return null;

  const insightsHref = `/session/${sessionId}/insights`;

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className={STYLE.eyebrow} style={{ color: TOK.textMuted }}>
            Health at a glance
          </span>
          <span
            className="text-xs"
            style={{ color: TOK.textMuted }}
            title="These tiles are computed from 17 deterministic rule-based signals — no AI involved. The /insights page adds Claude's plain-English commentary on the same signals."
          >
            · rule-based signals · no AI required
          </span>
        </div>
        <Link
          href={insightsHref}
          className="text-xs inline-flex items-center gap-1 transition hover:underline"
          style={{ color: TOK.textSecondary }}
        >
          View AI commentary
          <ArrowRight size={11} />
        </Link>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        {summaries.map((s) => (
          <HealthTile key={s.id} summary={s} insightsHref={insightsHref} />
        ))}
      </div>
    </section>
  );
}

/** Per-(dimension, status) fallback when no signal-derived detail exists.
 *  Mostly hits when the dimension is healthy with no specific signal to
 *  cite (Hygiene defaulting to healthy because license + README are
 *  present is the canonical case). Specific labels read better than a
 *  generic "—" or "No data". */
function fallbackDetail(summary: DimensionSummary): string {
  if (summary.status === "unknown") return "Refresh to populate";
  if (summary.status === "solo") return "Single contributor";
  if (summary.status === "healthy") {
    switch (summary.id) {
      case "hygiene":
        return "License + README present";
      case "deps":
        return "No CVEs, deprecations, or stale packages";
      case "activity":
        return "Recent commits";
      case "team":
        return "Healthy participation";
      case "code":
        return "No structural concerns";
      case "pr-flow":
        return "Reviews keep pace with intake";
    }
  }
  // Warning/critical without a signal shouldn't happen — but be safe.
  return "—";
}

function HealthTile({
  summary,
  insightsHref,
}: {
  summary: DimensionSummary;
  insightsHref: string;
}) {
  const style = STATUS_STYLES[summary.status];
  const { Icon } = style;

  // Unknown / solo tiles are non-actionable, so render as plain divs.
  // Other statuses link to /insights so users can dig into the evidence.
  const isInteractive =
    summary.status !== "unknown" && summary.status !== "solo";

  const detailText = summary.detail ?? fallbackDetail(summary);

  const Body = (
    <>
      <div className="flex items-center gap-1.5">
        <Icon size={13} />
        <span
          className="text-[10px] uppercase tracking-[0.08em] font-semibold"
          style={{ color: style.fg }}
        >
          {summary.statusLabel}
        </span>
      </div>
      <div
        className="text-[15px] font-semibold leading-tight"
        style={{ color: TOK.textPrimary, letterSpacing: "-0.01em" }}
      >
        {summary.label}
      </div>
      <div
        className="text-[11px] leading-snug line-clamp-2 mt-auto"
        style={{ color: TOK.textMuted }}
        title={detailText}
      >
        {detailText}
      </div>
    </>
  );

  const className =
    "flex flex-col gap-2 p-4 rounded-xl transition" +
    (isInteractive
      ? " group hover:brightness-110 cursor-pointer"
      : "");
  // Diagonal gradient matches SinceLastVisit + HeadlineFinding so the
  // panels read as one visual family. Status color tints the upper-left,
  // fading to the deep page bg in the lower-right. p-4 padding matches
  // QuickLookCard so the two strips read as the same card style.
  const inlineStyle = {
    background: `linear-gradient(135deg, ${style.bg} 0%, transparent 70%), ${TOK.surface}`,
    border: `1px solid ${style.border}`,
    color: style.fg,
    minHeight: 96,
  };

  if (isInteractive) {
    return (
      <Link href={insightsHref} className={className} style={inlineStyle}>
        {Body}
      </Link>
    );
  }
  return (
    <div className={className} style={inlineStyle}>
      {Body}
    </div>
  );
}
