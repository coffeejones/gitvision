// RollupBar / RollupCounts — the two posture-verdict primitives (Phase 2 / Move E).
//
// A rollup answers the above-the-fold question each tab currently leaves
// implicit: "am I okay, and by how much?" — derived ENTIRELY from arrays the
// page already computes (zero new analysis). It is deliberately a status TALLY,
// never a grade: it shows the split, it doesn't score it.
//
// Colors come from the caller, always — each surface owns its own tokens
// (HealthSummary STATUS_STYLES, PRFlow NODE_COLOR, WeakSuite TIER_META,
// TOK.rose/amber/textMuted). These primitives are layout + the one thing worth
// centralizing: the label grammar (count-first, lowercase noun, "·"-joined).

import type { ReactNode } from "react";
import { TOK } from "@/lib/sessionTheme";

export interface RollupSegment {
  /** How many items in this bucket. Zero-count segments drop out of both the
   *  bar and the legend so a clean posture reads clean. */
  count: number;
  /** Bucket color — passed in by the surface that owns the data. */
  color: string;
  /** Lowercase noun phrase: "critical", "need work", "load-bearing". The
   *  count is prepended by the component, so DON'T include it here. */
  label: string;
}

interface BarProps {
  segments: RollupSegment[];
  /** Denominator for the bar widths + the "of N" context. Defaults to the sum
   *  of segment counts; pass an explicit total when the pool is larger than the
   *  segments shown (e.g. Faultline's simulatable set > classified files). */
  total?: number;
  /** Optional muted trailing note (a median, an excluded-bots count). Lives
   *  here, never in the orientation lead. */
  trailing?: ReactNode;
  /** Word shown when every segment is zero — "No findings", "No PRs yet". */
  emptyLabel?: string;
}

/** A thin stacked bar sized by segment counts, over a legend of count-first
 *  labels. The bar is the picture; the legend is the exact tally. */
export function RollupBar({
  segments,
  total,
  trailing,
  emptyLabel = "Nothing to show yet",
}: BarProps) {
  const shown = segments.filter((s) => s.count > 0);
  const sum = segments.reduce((n, s) => n + s.count, 0);
  const denom = total ?? sum;

  if (sum === 0 || denom === 0) {
    return (
      <div className="flex flex-col gap-2">
        <div
          className="h-1.5 rounded-full w-full"
          style={{ background: TOK.surfaceElevated }}
        />
        <div className="text-xs" style={{ color: TOK.textMuted }}>
          {emptyLabel}
          {trailing ? <span> · {trailing}</span> : null}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div
        className="flex h-1.5 rounded-full overflow-hidden w-full"
        style={{ background: TOK.surfaceElevated }}
        aria-hidden
      >
        {shown.map((s, i) => (
          <span
            key={i}
            style={{
              width: `${(s.count / denom) * 100}%`,
              background: s.color,
            }}
          />
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        {shown.map((s, i) => (
          <span key={i} className="inline-flex items-center gap-1.5">
            <span
              className="h-2 w-2 rounded-full shrink-0"
              style={{ background: s.color }}
            />
            <span style={{ color: TOK.textSecondary }}>
              <span
                className="font-mono tabular-nums"
                style={{ color: TOK.textPrimary }}
              >
                {s.count.toLocaleString()}
              </span>{" "}
              {s.label}
            </span>
          </span>
        ))}
        {trailing && (
          <span style={{ color: TOK.textMuted }} className="ml-auto">
            {trailing}
          </span>
        )}
      </div>
    </div>
  );
}

interface CountsProps {
  /** Pre-formatted count phrases, e.g. "1,204 functions", "87% of call sites
   *  resolved". Joined with "·". Falsy entries are dropped so conditional
   *  clauses (a coverage number only when test files exist) compose cleanly. */
  parts: Array<string | false | null | undefined>;
}

/** The lighter rollup shape — a "·"-joined count line, no bar. For surfaces
 *  where the numbers don't partition a whole (Code: functions + resolution% +
 *  duplicate groups aren't slices of one pie). */
export function RollupCounts({ parts }: CountsProps) {
  const shown = parts.filter((p): p is string => Boolean(p));
  if (shown.length === 0) return null;
  return (
    <div
      className="text-xs font-mono tabular-nums flex flex-wrap items-center gap-x-2 gap-y-1"
      style={{ color: TOK.textSecondary }}
    >
      {shown.map((p, i) => (
        <span key={i} className="inline-flex items-center gap-2">
          {i > 0 && <span style={{ color: TOK.textMuted }}>·</span>}
          <span>{p}</span>
        </span>
      ))}
    </div>
  );
}
