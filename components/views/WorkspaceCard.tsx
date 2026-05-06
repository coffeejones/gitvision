// Workspace dashboard card (v0.68 / C3).
//
// One row per session in the workspace dashboard. Designed for
// power-users with 3+ sessions who want "where should I focus
// across my analyzed repos" at a glance, without clicking into
// each one. Each card shows:
//
//   - Repo identity + custom name + snapshot count + last refresh
//   - Top finding from the headline waterfall (severity-colored)
//   - Mini-strip of 6 dimension dots (color-coded status)
//   - Critical-issue chip when present
//
// Click anywhere → navigates to /session/{id}. Hover lifts the
// border for affordance.
//
// Pure presentation — all data shape lives in WorkspaceSummary.

import Link from "next/link";
import {
  AlertCircle,
  ArrowRight,
  Check,
  Minus,
  ShieldAlert,
  User,
} from "lucide-react";
import type { WorkspaceSummary } from "@/lib/intelligence/workspaceSummary";
import type {
  DimensionStatus,
  DimensionSummary,
} from "@/lib/intelligence/healthSummary";
import type { HeadlineSeverity } from "@/lib/intelligence/headline";
import { TOK } from "@/lib/theme";

interface Props {
  summary: WorkspaceSummary;
}

/** Foreground color per dimension status — matches the HealthSummary
 *  tiles on the Overview page, so the visual language is consistent
 *  between the dashboard and the per-session view. */
const STATUS_COLOR: Record<DimensionStatus, string> = {
  critical: TOK.rose,
  warning: TOK.amber,
  healthy: TOK.accent,
  solo: TOK.textSecondary,
  unknown: TOK.textMuted,
};

const HEADLINE_COLOR: Record<HeadlineSeverity, string> = {
  critical: TOK.rose,
  warning: TOK.amber,
  info: TOK.accent,
};

const HEADLINE_BG: Record<HeadlineSeverity, string> = {
  critical: TOK.roseSoft,
  warning: TOK.amberSoft,
  info: TOK.accentSoft,
};

const HEADLINE_ICON: Record<
  HeadlineSeverity,
  React.ComponentType<{ size?: number }>
> = {
  critical: ShieldAlert,
  warning: AlertCircle,
  info: Check,
};

export function WorkspaceCard({ summary }: Props) {
  const HeadlineIcon = HEADLINE_ICON[summary.headline.severity];
  const headlineColor = HEADLINE_COLOR[summary.headline.severity];
  const headlineBg = HEADLINE_BG[summary.headline.severity];

  return (
    <Link
      href={`/session/${summary.id}`}
      className="group flex flex-col gap-3 p-4 rounded-xl transition"
      style={{
        background: TOK.surface,
        border: `1px solid ${TOK.border}`,
      }}
    >
      {/* Identity row — repo + name on left, snapshot count + age on right */}
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <div className="flex items-baseline gap-2 min-w-0">
          <span
            className="font-mono text-sm truncate"
            style={{ color: TOK.textPrimary }}
            title={summary.repoFullName}
          >
            {summary.repoFullName}
          </span>
          {summary.name &&
            summary.name !== summary.repoFullName && (
              <span
                className="text-xs truncate"
                style={{ color: TOK.textSecondary }}
              >
                · {summary.name}
              </span>
            )}
        </div>
        <div
          className="flex items-center gap-2 text-[11px] font-mono shrink-0"
          style={{ color: TOK.textMuted }}
        >
          <span title={`${summary.snapshotCount} snapshots stored`}>
            {summary.snapshotCount} snap
            {summary.snapshotCount === 1 ? "" : "s"}
          </span>
          <span>·</span>
          <span title={summary.updatedAt}>{formatRel(summary.updatedAt)}</span>
        </div>
      </div>

      {/* Headline finding — severity-tinted, single-line summary */}
      <div
        className="flex items-start gap-2.5 px-3 py-2 rounded-lg"
        style={{
          background: `linear-gradient(135deg, ${headlineBg} 0%, transparent 70%), ${TOK.bg}`,
          border: `1px solid ${headlineColor}33`,
        }}
      >
        <span style={{ color: headlineColor, marginTop: 1 }}>
          <HeadlineIcon size={13} />
        </span>
        <span
          className="text-xs leading-snug line-clamp-2"
          style={{ color: TOK.textPrimary }}
        >
          {summary.headline.primary}
        </span>
      </div>

      {/* Dimension mini-strip — six color-coded dots + label, mirrors
       *  HealthSummary tiles on the Overview but compact (just dot +
       *  label, no detail-line). */}
      <div className="flex items-center gap-3 flex-wrap">
        {summary.dimensions.map((d) => (
          <DimensionDot key={d.id} dim={d} />
        ))}
        <ArrowRight
          size={13}
          className="ml-auto opacity-40 group-hover:opacity-100 transition"
          style={{ color: TOK.textSecondary }}
        />
      </div>
    </Link>
  );
}

function DimensionDot({ dim }: { dim: DimensionSummary }) {
  const color = STATUS_COLOR[dim.status];
  const Icon =
    dim.status === "solo"
      ? User
      : dim.status === "unknown"
        ? Minus
        : null;
  return (
    <span
      className="inline-flex items-center gap-1.5 text-[11px]"
      style={{ color: TOK.textSecondary }}
      title={`${dim.label}: ${dim.statusLabel}${dim.detail ? ` — ${dim.detail}` : ""}`}
    >
      {Icon ? (
        <span style={{ color }}>
          <Icon size={9} />
        </span>
      ) : (
        <span
          className="h-2 w-2 rounded-full inline-block"
          style={{ background: color }}
        />
      )}
      <span>{dim.label}</span>
    </span>
  );
}

/** Compact relative-time formatter ("2h ago", "3d ago", "May 4"). */
function formatRel(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = 60_000;
  const hr = 60 * min;
  const day = 24 * hr;
  if (diff < min) return "just now";
  if (diff < hr) return `${Math.floor(diff / min)}m ago`;
  if (diff < day) return `${Math.floor(diff / hr)}h ago`;
  const days = Math.floor(diff / day);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}
