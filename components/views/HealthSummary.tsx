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
import {
  ArrowRight,
  AlertCircle,
  Check,
  Minus,
  TrendingDown,
  TrendingUp,
  User,
} from "lucide-react";
import type {
  DimensionDelta,
  DimensionId,
  DimensionStatus,
  DimensionSummary,
  DimensionTrend,
} from "@/lib/intelligence/healthSummary";
import { STYLE, TOK } from "@/lib/sessionTheme";

/** Map a tile's status to the relevant Health-check column anchor on
 *  /insights. critical + warning tiles want the "needs work" column;
 *  healthy tiles want the "what works" column. solo + unknown don't
 *  link anywhere — there's nothing to drill into. */
function anchorForStatus(status: DimensionStatus): string | null {
  switch (status) {
    case "critical":
    case "warning":
      return "health-needs-work";
    case "healthy":
      return "health-working";
    case "solo":
    case "unknown":
      return null;
  }
}

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
  /** Optional per-dimension diff vs. the previous snapshot (v0.62/B5).
   *  When present, tiles whose status actually changed render a small
   *  TrendingUp/TrendingDown icon next to the status label. Pass
   *  undefined when there's no previous snapshot. */
  deltas?: DimensionDelta[];
  /** Optional per-dimension trend (last N statuses, oldest-first)
   *  from v0.68 / C3. When present, tiles render a tiny inline
   *  sparkline so power-users see direction-of-travel at a glance.
   *  Pass undefined when the session has fewer than 3 snapshots —
   *  the structural-diff panel + delta arrows already cover the
   *  current-vs-previous case. */
  trend?: DimensionTrend;
}

export function HealthSummary({
  summaries,
  sessionId,
  deltas,
  trend,
}: Props) {
  // Hide entirely if every dimension is unknown. Means we have no data to
  // talk about — quick-look-cards already say "refresh to populate".
  if (summaries.every((d) => d.status === "unknown")) return null;

  const insightsHref = `/session/${sessionId}/insights`;
  const deltaById = new Map(deltas?.map((d) => [d.id, d]));

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
            title="These tiles are computed from 20 deterministic rule-based signals — no AI involved. The /insights page adds Claude's plain-English commentary on the same signals."
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
          <HealthTile
            key={s.id}
            summary={s}
            insightsBase={insightsHref}
            delta={deltaById.get(s.id)}
            trendSeries={trend?.get(s.id)}
          />
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
  insightsBase,
  delta,
  trendSeries,
}: {
  summary: DimensionSummary;
  /** Base /session/{id}/insights path — the tile appends the relevant
   *  column anchor for its status so the link scrolls into the right
   *  column on the verdict page. */
  insightsBase: string;
  /** Optional change indicator vs. previous snapshot. Renders a tiny
   *  TrendingUp (green) or TrendingDown (rose) icon next to the
   *  status label when the dimension actually changed. */
  delta?: DimensionDelta;
  /** Optional last-N-snapshots status sequence (oldest-first). When
   *  provided AND length >= 3, renders an inline sparkline at the
   *  bottom of the tile so power-users see direction-of-travel. */
  trendSeries?: DimensionStatus[];
}) {
  const style = STATUS_STYLES[summary.status];
  const { Icon } = style;

  // Unknown / solo tiles are non-actionable, so render as plain divs.
  // Other statuses link to /insights with an anchor so users land in
  // the column whose copy applies to this tile's status.
  const anchor = anchorForStatus(summary.status);
  const isInteractive = anchor !== null;
  const href = anchor ? `${insightsBase}#${anchor}` : insightsBase;

  const detailText = summary.detail ?? fallbackDetail(summary);

  // Change indicator — tiny TrendingUp/Down icon when the dimension's
  // status changed since the previous snapshot. Color-codes the
  // direction (improvements green, regressions rose) and the tooltip
  // spells out the from/to so the icon isn't ambiguous.
  const changeIcon = (() => {
    if (!delta || delta.change === "unchanged") return null;
    const isImproved = delta.change === "improved";
    const ChangeIcon = isImproved ? TrendingUp : TrendingDown;
    const color = isImproved ? TOK.accent : TOK.rose;
    const label = isImproved
      ? `Improved from ${delta.fromStatus}`
      : `Regressed from ${delta.fromStatus}`;
    return (
      <span
        className="ml-auto inline-flex items-center"
        style={{ color }}
        title={label}
        aria-label={label}
      >
        <ChangeIcon size={12} />
      </span>
    );
  })();

  // Sparkline only renders when we have a meaningful trend (3+ data
  // points). 1-2 data points = no real direction, that signal is
  // already covered by the delta arrow.
  const showSparkline = trendSeries && trendSeries.length >= 3;

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
        {changeIcon}
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
      {showSparkline && trendSeries && (
        <TrendSparkline series={trendSeries} dimensionId={summary.id} />
      )}
    </>
  );

  const className =
    "flex flex-col gap-2 p-4 rounded-xl transition" +
    (isInteractive
      ? " group hover:brightness-110 cursor-pointer"
      : "");
  // Severity-tinted diagonal gradient + the same 1px ambient + lift
  // shadow recipe as the rest of the page's material cards. Matches
  // SinceLastVisit + HeadlineFinding so the panels read as one
  // visual family. Status colour tints upper-left, fading to the
  // gradient-elevated surface in the lower-right.
  const inlineStyle = {
    background: `linear-gradient(135deg, ${style.bg} 0%, transparent 70%), ${TOK.surface}`,
    border: `1px solid ${style.border}`,
    color: style.fg,
    minHeight: 96,
  };

  if (isInteractive) {
    return (
      <Link href={href} className={className} style={inlineStyle}>
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

/** Inline sparkline rendering a status sequence (oldest-first) as a
 *  horizontal row of dots, color-coded by status. Compact enough to
 *  sit inside a HealthSummary tile without competing with the
 *  primary content; tooltip explains the data behind the dots.
 *
 *  Visual choice: dots > line chart because status is a discrete
 *  enum (5 values), not a continuous metric. A line implies
 *  interpolation between healthy ↔ critical that doesn't exist. */
function TrendSparkline({
  series,
  dimensionId,
}: {
  series: DimensionStatus[];
  dimensionId: DimensionId;
}) {
  const colorOf = (s: DimensionStatus): string => {
    switch (s) {
      case "critical":
        return TOK.rose;
      case "warning":
        return TOK.amber;
      case "healthy":
        return TOK.accent;
      case "solo":
        return TOK.textSecondary;
      case "unknown":
        return TOK.textMuted;
    }
  };
  const tooltip = `Trend across last ${series.length} snapshots: ${series.join(" → ")}`;
  return (
    <div
      className="flex items-center gap-1 pt-1.5"
      title={tooltip}
      aria-label={`${dimensionId} trend: ${series.join(", ")}`}
    >
      {series.map((status, i) => (
        <span
          key={i}
          className="rounded-full inline-block"
          style={{
            background: colorOf(status),
            // Last dot slightly larger so the eye lands on "now"
            width: i === series.length - 1 ? 6 : 4,
            height: i === series.length - 1 ? 6 : 4,
            opacity: i === series.length - 1 ? 1 : 0.55,
          }}
        />
      ))}
    </div>
  );
}
