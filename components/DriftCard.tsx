"use client";

// Drift "direction of travel" share card (Arc 3 distribution beat). Same
// bitumen-ground / bone-text / one-International-Orange language as WallCard and
// ShareCard, but the content is the temporal story: how the codebase's health
// metrics moved across N sweeps. The card nobody else can make — it needs
// accumulated snapshots. Renders at exact pixel dimensions for a
// publishing-ready PNG.

import type { AnalysisSnapshot } from "@/lib/types";
import { driftRows, type DriftReport, type DriftTrend } from "@/lib/driftMetrics";
import { ctDisplay, ctMono } from "@/components/landing/codetrawl/ctFonts";

const DISPLAY = `${ctDisplay.style.fontFamily}, -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif`;
const MONO = `${ctMono.style.fontFamily}, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`;

export type DriftCardVariant = "landscape" | "square";

const DIMS: Record<DriftCardVariant, { w: number; h: number }> = {
  landscape: { w: 1200, h: 630 },
  square: { w: 1080, h: 1080 },
};

const ORANGE = "#ff4f00";
const EMBER = "#ff8a50";
const BONE = "#eceae8";
// A restrained, desaturated mint for improvements — cool enough to read as
// "good news" at a glance against the warm bitumen, muted enough to stay
// premium and not fight the one International-Orange accent.
const POSITIVE = "#7fc7a1";

function shortName(fullName: string): string {
  return fullName.split("/").pop() || fullName;
}

/** Value with unit for the then → now display. */
function fmt(value: number, unit: DriftTrend["unit"]): string {
  if (unit === "%") return `${value}%`;
  if (unit === "×") return `${value}×`;
  return `${value}`;
}

/** Signed delta with unit, e.g. "+34%", "−12", "+0.3×". */
function fmtDelta(t: DriftTrend): string {
  const sign = t.delta > 0 ? "+" : "−";
  const mag = Math.abs(t.delta);
  if (t.unit === "%") return `${sign}${mag}%`;
  if (t.unit === "×") return `${sign}${mag}×`;
  return `${sign}${mag}`;
}

function spanDays(report: DriftReport): number {
  if (!report.baselineAt || !report.latestAt) return 0;
  const ms = Date.parse(report.latestAt) - Date.parse(report.baselineAt);
  return Math.max(0, Math.round(ms / 86_400_000));
}

interface Props {
  snapshot: AnalysisSnapshot;
  report: DriftReport;
  variant: DriftCardVariant;
}

export function DriftCard({ snapshot, report, variant }: Props) {
  const dim = DIMS[variant];
  const isSquare = variant === "square";

  // The full fingerprint — all five quality metrics, movers first (worst-first)
  // then the stable ones muted, so the card always reads as complete rather
  // than sparse when only one or two metrics drifted. Falls back to just the
  // moved trends if the raw endpoints somehow aren't on the report.
  const allRows =
    report.baseline && report.latest
      ? driftRows(report.baseline, report.latest)
      : report.trends.map((t) => ({ ...t, moved: true }));
  const rows = [...allRows].sort(
    (a, b) =>
      Number(b.moved) - Number(a.moved) ||
      Number(b.worse) - Number(a.worse) ||
      Math.abs(b.delta) - Math.abs(a.delta)
  );
  const regressions = report.trends.filter((t) => t.worse).length;
  const improvements = report.trends.length - regressions;
  const days = spanDays(report);

  return (
    <div
      style={{
        width: dim.w,
        height: dim.h,
        background:
          "linear-gradient(135deg, #0c0b0b 0%, #141210 55%, #1c140d 100%)",
        color: BONE,
        fontFamily: DISPLAY,
        padding: isSquare ? 64 : 56,
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        gap: isSquare ? 34 : 24,
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Brand glows */}
      <div
        style={{
          position: "absolute",
          top: -160,
          right: -160,
          width: 480,
          height: 480,
          borderRadius: "50%",
          background:
            "radial-gradient(circle, rgba(255,79,0,0.20) 0%, rgba(255,79,0,0) 70%)",
          filter: "blur(8px)",
          pointerEvents: "none",
        }}
      />
      <div
        style={{
          position: "absolute",
          bottom: -200,
          left: -200,
          width: 540,
          height: 540,
          borderRadius: "50%",
          background:
            "radial-gradient(circle, rgba(255,138,80,0.10) 0%, rgba(255,138,80,0) 70%)",
          filter: "blur(8px)",
          pointerEvents: "none",
        }}
      />

      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          position: "relative",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: "50%",
              background: ORANGE,
              boxShadow: "0 0 12px rgba(255,79,0,0.55)",
            }}
          />
          <span style={{ fontSize: 16, fontWeight: 600, letterSpacing: "-0.01em" }}>
            CodeTrawl
          </span>
        </div>
        <span style={{ fontSize: 13, color: "rgba(255,255,255,0.55)", fontFamily: MONO }}>
          {snapshot.repo.fullName}
        </span>
      </div>

      {/* Title */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8, position: "relative" }}>
        <div
          style={{
            fontSize: 13,
            textTransform: "uppercase",
            letterSpacing: "0.16em",
            color: EMBER,
            fontFamily: MONO,
          }}
        >
          Direction of travel · {report.sweeps} sweeps
          {days > 0 ? ` over ${days} day${days === 1 ? "" : "s"}` : ""}
        </div>
        <div
          style={{
            fontSize: isSquare ? 60 : 52,
            fontWeight: 700,
            lineHeight: 1.02,
            letterSpacing: "-0.035em",
            background:
              "linear-gradient(90deg, #ffffff 0%, #eceae8 55%, #b0aca8 100%)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            backgroundClip: "text",
          }}
        >
          Where {shortName(snapshot.repo.fullName)} is heading
        </div>
      </div>

      {/* Trend rows — the full five-metric fingerprint */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: isSquare ? 18 : 13,
          position: "relative",
          flex: 1,
          minHeight: 0,
          justifyContent: "flex-start",
          paddingTop: isSquare ? 8 : 4,
        }}
      >
        {rows.map((t) => {
          // Movers carry the color; stable rows recede so the eye lands on
          // what actually drifted.
          const c = !t.moved
            ? "rgba(255,255,255,0.32)"
            : t.worse
              ? ORANGE
              : POSITIVE;
          const arrow = !t.moved ? "→" : t.delta > 0 ? "↗" : "↘";
          const labelColor = t.moved ? BONE : "rgba(236,234,232,0.5)";
          return (
            <div
              key={t.key}
              style={{ display: "flex", alignItems: "center", gap: 16 }}
            >
              <span
                style={{
                  fontSize: isSquare ? 30 : 26,
                  color: c,
                  fontFamily: MONO,
                  width: 26,
                  flexShrink: 0,
                }}
              >
                {arrow}
              </span>
              <span
                style={{
                  fontSize: isSquare ? 27 : 23,
                  fontWeight: t.moved ? 600 : 500,
                  color: labelColor,
                  flexShrink: 0,
                }}
              >
                {t.label}
              </span>
              {/* connecting rule */}
              <span
                style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.08)" }}
              />
              <span
                style={{
                  fontSize: isSquare ? 20 : 17,
                  fontFamily: MONO,
                  color: t.moved ? "rgba(255,255,255,0.5)" : "rgba(255,255,255,0.32)",
                  flexShrink: 0,
                }}
              >
                {fmt(t.from, t.unit)} → {fmt(t.to, t.unit)}
              </span>
              {t.moved ? (
                <span
                  style={{
                    fontSize: isSquare ? 22 : 18,
                    fontWeight: 700,
                    fontFamily: MONO,
                    color: c,
                    background: t.worse
                      ? "rgba(255,79,0,0.14)"
                      : "rgba(127,199,161,0.14)",
                    border: `1px solid ${
                      t.worse ? "rgba(255,79,0,0.4)" : "rgba(127,199,161,0.4)"
                    }`,
                    borderRadius: 8,
                    padding: isSquare ? "5px 12px" : "4px 10px",
                    minWidth: isSquare ? 92 : 78,
                    textAlign: "center",
                    flexShrink: 0,
                  }}
                >
                  {fmtDelta(t)}
                </span>
              ) : (
                <span
                  style={{
                    fontSize: isSquare ? 18 : 15,
                    fontFamily: MONO,
                    color: "rgba(255,255,255,0.3)",
                    minWidth: isSquare ? 92 : 78,
                    textAlign: "center",
                    flexShrink: 0,
                  }}
                >
                  steady
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* Summary + footer */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          position: "relative",
        }}
      >
        <div style={{ display: "flex", gap: 18, fontSize: 14 }}>
          {regressions > 0 && (
            <span>
              <span style={{ color: ORANGE, fontWeight: 700, fontFamily: MONO }}>
                {regressions}
              </span>{" "}
              <span style={{ color: "rgba(255,255,255,0.5)" }}>
                drifting the wrong way
              </span>
            </span>
          )}
          {improvements > 0 && (
            <span>
              <span style={{ color: POSITIVE, fontWeight: 700, fontFamily: MONO }}>
                {improvements}
              </span>{" "}
              <span style={{ color: "rgba(255,255,255,0.5)" }}>improving</span>
            </span>
          )}
        </div>
        <span style={{ fontSize: 12, color: "rgba(255,255,255,0.45)" }}>
          codetrawl.com · the drift nobody else can see
        </span>
      </div>
    </div>
  );
}

export { DIMS as DRIFT_CARD_DIMS };
