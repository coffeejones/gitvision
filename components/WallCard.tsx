"use client";

// Load-bearing walls share card (Arc 1 distribution beat). Same "SURFACE &
// DEPTH" language as ShareCard — bitumen ground, bone text, one International
// Orange accent — but the content is the refactor-safety verdict: the files
// that ripple the widest with the thinnest test net, the ones nobody dares
// touch. Renders at exact pixel dimensions for a publishing-ready PNG.

import type { AnalysisSnapshot } from "@/lib/types";
import type { RefactorSafetyReport, SafetyTier } from "@/lib/refactorSafety";
import { ctDisplay, ctMono } from "@/components/landing/codetrawl/ctFonts";

const DISPLAY = `${ctDisplay.style.fontFamily}, -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif`;
const MONO = `${ctMono.style.fontFamily}, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`;

export type WallCardVariant = "landscape" | "square";

const DIMS: Record<WallCardVariant, { w: number; h: number }> = {
  landscape: { w: 1200, h: 630 },
  square: { w: 1080, h: 1080 },
};

const TIER_DOT: Record<SafetyTier, string> = {
  "load-bearing": "#ff4f00",
  "handle-with-care": "#c2693a",
  moderate: "rgba(255,255,255,0.4)",
  safe: "rgba(255,255,255,0.25)",
};

function baseName(p: string): string {
  return p.split("/").pop() || p;
}
function dirName(p: string): string {
  return p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "";
}

interface Props {
  snapshot: AnalysisSnapshot;
  report: RefactorSafetyReport;
  variant: WallCardVariant;
}

export function WallCard({ snapshot, report, variant }: Props) {
  const dim = DIMS[variant];
  const isSquare = variant === "square";

  // The scariest files by rank (whatever tier), so a small repo still fills
  // the card. Landscape is short (630px) — 4 fit without the footer crowding
  // the last row; the taller square shows more. Most are load-bearing on any
  // real codebase.
  const walls = report.files.slice(0, isSquare ? 7 : 4);
  const maxDep = Math.max(1, ...walls.map((w) => w.dependents));

  return (
    <div
      style={{
        width: dim.w,
        height: dim.h,
        background:
          "linear-gradient(135deg, #0c0b0b 0%, #141210 55%, #1c140d 100%)",
        color: "#eceae8",
        fontFamily: DISPLAY,
        padding: isSquare ? 64 : 56,
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        gap: isSquare ? 30 : 22,
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
              background: "#ff4f00",
              boxShadow: "0 0 12px rgba(255,79,0,0.55)",
            }}
          />
          <span style={{ fontSize: 16, fontWeight: 600, letterSpacing: "-0.01em" }}>
            CodeTrawl
          </span>
        </div>
        <span
          style={{ fontSize: 13, color: "rgba(255,255,255,0.55)", fontFamily: MONO }}
        >
          {snapshot.repo.fullName}
        </span>
      </div>

      {/* Title */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6, position: "relative" }}>
        <div
          style={{
            fontSize: 13,
            textTransform: "uppercase",
            letterSpacing: "0.16em",
            color: "#ff8a50",
          }}
        >
          Load-bearing walls
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
          The files nobody dares touch
        </div>
      </div>

      {/* Walls list */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: isSquare ? 14 : 12,
          position: "relative",
          flex: 1,
          minHeight: 0,
        }}
      >
        {walls.map((w) => (
          <div key={w.file} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
              <span
                style={{
                  width: 9,
                  height: 9,
                  borderRadius: "50%",
                  background: TIER_DOT[w.tier],
                  flexShrink: 0,
                  transform: "translateY(1px)",
                }}
              />
              <span
                style={{
                  fontSize: isSquare ? 24 : 22,
                  fontWeight: 600,
                  fontFamily: MONO,
                  color: "#eceae8",
                }}
              >
                {baseName(w.file)}
              </span>
              <span
                style={{
                  fontSize: 13,
                  fontFamily: MONO,
                  color: "rgba(255,255,255,0.4)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {dirName(w.file)}
              </span>
            </div>
            {/* Heat bar (by dependents) */}
            <div
              style={{
                height: 7,
                borderRadius: 4,
                background: "rgba(255,255,255,0.06)",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  height: "100%",
                  width: `${(w.dependents / maxDep) * 100}%`,
                  background: "linear-gradient(90deg, #c2693a, #ff4f00)",
                }}
              />
            </div>
            {/* Evidence */}
            <div
              style={{
                display: "flex",
                gap: 16,
                fontSize: 14,
                fontFamily: MONO,
                color: "rgba(255,255,255,0.62)",
              }}
            >
              <span>{w.dependents} dependents</span>
              {w.untestedDependents > 0 && (
                <span style={{ color: "#ff8a50" }}>
                  {w.untestedDependents} untested
                </span>
              )}
              <span>complexity {w.complexity}</span>
              {w.duplicatedFns > 0 && <span>{w.duplicatedFns}× duplicated</span>}
            </div>
          </div>
        ))}
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
          <span>
            <span style={{ color: "#ff4f00", fontWeight: 700, fontFamily: MONO }}>
              {report.counts["load-bearing"]}
            </span>{" "}
            <span style={{ color: "rgba(255,255,255,0.5)" }}>load-bearing</span>
          </span>
          <span>
            <span style={{ color: "#c2693a", fontWeight: 700, fontFamily: MONO }}>
              {report.counts["handle-with-care"]}
            </span>{" "}
            <span style={{ color: "rgba(255,255,255,0.5)" }}>handle with care</span>
          </span>
          <span style={{ color: "rgba(255,255,255,0.4)", fontFamily: MONO }}>
            {report.totalFiles} files analyzed
          </span>
        </div>
        <span style={{ fontSize: 12, color: "rgba(255,255,255,0.45)" }}>
          codetrawl.com · know what breaks before you touch it
        </span>
      </div>
    </div>
  );
}

export { DIMS as WALL_CARD_DIMS };
