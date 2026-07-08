// "Drift — direction of travel" panel for the Overview (Arc 3).
//
// The temporal-intelligence display: it diffs a session's snapshots into a
// multi-sweep trend ("duplication rose 34% since you first looked") rather
// than the single current-vs-previous delta the SinceLastVisit / StructuralDiff
// panels already cover. Sits highest in the temporal stack because it's the
// most zoomed-out read: where is this codebase heading over time.
//
// Thin renderer — the parent computes the report (lib/driftMetrics.ts) and
// decides whether to render at all (it hides on single-snapshot sessions and
// when nothing drifted beyond the noise floor). Gated to Plus alongside the
// other snapshot-diff surfaces.

import { TrendingDown, TrendingUp } from "lucide-react";
import type { DriftReport, DriftTrend } from "@/lib/driftMetrics";
import { STYLE, TOK } from "@/lib/sessionTheme";
import { HelpHint } from "@/components/HelpHint";

interface Props {
  report: DriftReport;
}

/** Format a metric value with its unit for the from → to display. */
function fmt(value: number, unit: DriftTrend["unit"]): string {
  if (unit === "%") return `${value}%`;
  if (unit === "×") return `${value}×`;
  return `${value}`; // complexity — bare number reads cleaner than "5 cx"
}

/** Signed delta with unit, e.g. "+34%", "−12", "+0.3×". */
function fmtDelta(t: DriftTrend): string {
  const sign = t.delta > 0 ? "+" : "−";
  const mag = Math.abs(t.delta);
  if (t.unit === "%") return `${sign}${mag}%`;
  if (t.unit === "×") return `${sign}${mag}×`;
  return `${sign}${mag}`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function DriftPanel({ report }: Props) {
  const regressions = report.trends.filter((t) => t.worse).length;
  const improvements = report.trends.length - regressions;

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline gap-2 flex-wrap">
        <span
          className={`${STYLE.eyebrow} inline-flex items-center gap-1.5`}
          style={{ color: TOK.textMuted }}
        >
          Drift
          <HelpHint
            anchor="sessions-snapshots"
            label="How drift is measured across snapshots"
          />
        </span>
        <span className="text-xs" style={{ color: TOK.textMuted }}>
          · direction of travel across {report.sweeps} sweeps
          {report.baselineAt ? `, since ${formatDate(report.baselineAt)}` : ""}
        </span>
      </div>

      <div
        className="rounded-xl p-5 flex flex-col gap-4"
        style={{ background: TOK.surface, border: `1px solid ${TOK.border}` }}
      >
        {/* One-line read of the whole panel. */}
        <p className="text-sm" style={{ color: TOK.textSecondary }}>
          {regressions > 0 ? (
            <>
              <strong style={{ color: TOK.textPrimary }}>
                {regressions}
              </strong>{" "}
              metric{regressions === 1 ? "" : "s"} drifted the wrong way
              {improvements > 0 ? (
                <>
                  {" "}
                  · {improvements} improved
                </>
              ) : (
                ""
              )}{" "}
              over {report.sweeps} sweeps.
            </>
          ) : (
            <>
              Every metric that moved improved over {report.sweeps} sweeps —{" "}
              <strong style={{ color: TOK.accent }}>trending healthy</strong>.
            </>
          )}
        </p>

        <ul className="flex flex-col divide-y" style={{ borderColor: TOK.border }}>
          {report.trends.map((t) => {
            const rose = t.worse;
            const accent = rose ? TOK.rose : TOK.accent;
            const Arrow = t.delta > 0 ? TrendingUp : TrendingDown;
            return (
              <li
                key={t.key}
                className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0"
              >
                <Arrow size={15} style={{ color: accent }} />
                <span
                  className="text-[13px] font-medium"
                  style={{ color: TOK.textPrimary }}
                >
                  {t.label}
                </span>
                <span
                  className="text-[11px] font-mono tabular-nums ml-auto"
                  style={{ color: TOK.textMuted }}
                >
                  {fmt(t.from, t.unit)} → {fmt(t.to, t.unit)}
                </span>
                <span
                  className="text-[11px] font-mono tabular-nums font-semibold px-2 py-0.5 rounded-md"
                  style={{
                    color: accent,
                    background: `${accent}1a`,
                    border: `1px solid ${accent}33`,
                  }}
                  title={
                    rose
                      ? "Moved in the unhealthy direction"
                      : "Moved in the healthy direction"
                  }
                >
                  {fmtDelta(t)}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
