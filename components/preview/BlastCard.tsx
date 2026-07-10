"use client";

// The exportable reviewer-brief card (Arc 5, beat 2). Renders a ChangeBlastReport
// at exact pixel dimensions so the html-to-image capture is publishing-ready
// (1200×630 for OG/Twitter, 1080×1080 for Instagram-ish). Same CodeTrawl
// "surface & depth" language as ShareCard — bitumen ground, bone text, one
// International Orange accent — captured live so the webfonts embed in the PNG.
//
// Restraint by design: the card shows evidence, never opinion. The verdict chip
// is a computed traffic light; every number is a receipt (walls touched,
// distinct files reached, guarding tests updated), cited to the code graph.

import { ctDisplay, ctMono } from "@/components/landing/codetrawl/ctFonts";
import type { ChangeBlastReport } from "@/lib/changeBlast/types";
import {
  ORANGE,
  EMBER,
  BONE,
  MINT,
  MUTED,
  VERDICT,
  KIND_LABEL,
  TIER_COLOR,
  baseName,
  dirName,
  formatNum,
} from "./previewTheme";

const DISPLAY = `${ctDisplay.style.fontFamily}, -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif`;
const MONO = `${ctMono.style.fontFamily}, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`;

export type BlastCardVariant = "landscape" | "square";

const DIMS: Record<BlastCardVariant, { w: number; h: number }> = {
  landscape: { w: 1200, h: 630 },
  square: { w: 1080, h: 1080 },
};

export interface BlastCardPr {
  owner: string;
  repo: string;
  number: number;
  title: string;
  baseRef: string;
  headRef: string;
}

function Receipt({
  value,
  label,
  color,
}: {
  value: string;
  label: string;
  color: string;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", padding: "10px 18px", flex: 1 }}>
      <span
        style={{
          fontSize: 40,
          fontWeight: 700,
          lineHeight: 1.05,
          letterSpacing: "-0.02em",
          fontFamily: MONO,
          color,
        }}
      >
        {value}
      </span>
      <span
        style={{
          fontSize: 12,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          color: "rgba(255,255,255,0.5)",
          marginTop: 4,
        }}
      >
        {label}
      </span>
    </div>
  );
}

interface Props {
  pr: BlastCardPr;
  report: ChangeBlastReport;
  variant: BlastCardVariant;
}

export function BlastCard({ pr, report, variant }: Props) {
  const dim = DIMS[variant];
  const isSquare = variant === "square";
  const v = VERDICT[report.verdict];

  // The three hero receipts.
  const walls = report.loadBearingTouched.length;
  const total = report.testsToRun.length;
  const updated = report.mappedTestsUpdated;
  const testsValue = total > 0 ? `${updated}/${total}` : "0";
  const testsLabel = total > 0 ? "guarding tests updated" : "guarding tests mapped";
  const testsColor = total > 0 ? (updated < total ? EMBER : MINT) : MUTED;

  // Evidence rows: the scariest real source files, tests filtered out (the
  // blast story is about production reach). Already risk-ranked upstream.
  const evidence = report.changedFiles.filter((f) => !f.isTest).slice(0, isSquare ? 6 : 3);

  const title = pr.title?.trim() || `${pr.baseRef} ← ${pr.headRef}`;

  return (
    <div
      style={{
        width: dim.w,
        height: dim.h,
        background: "linear-gradient(135deg, #0c0b0b 0%, #141210 55%, #1c140d 100%)",
        color: BONE,
        fontFamily: DISPLAY,
        padding: isSquare ? 64 : 56,
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        gap: isSquare ? 26 : 20,
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Brand glow — International Orange top-right, faint ember bottom-left. */}
      <div
        style={{
          position: "absolute",
          top: -160,
          right: -160,
          width: 480,
          height: 480,
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(255,79,0,0.20) 0%, rgba(255,79,0,0) 70%)",
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
          background: "radial-gradient(circle, rgba(255,138,80,0.10) 0%, rgba(255,138,80,0) 70%)",
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
          <span style={{ fontSize: 16, fontWeight: 600, letterSpacing: "-0.01em" }}>CodeTrawl</span>
        </div>
        <span style={{ fontSize: 13, color: "rgba(255,255,255,0.55)", fontFamily: MONO }}>
          {pr.owner}/{pr.repo} #{pr.number}
        </span>
      </div>

      {/* Verdict + title */}
      <div style={{ display: "flex", flexDirection: "column", gap: 14, position: "relative" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span
            style={{
              fontSize: 12,
              textTransform: "uppercase",
              letterSpacing: "0.16em",
              color: v.color,
              fontWeight: 600,
            }}
          >
            Change blast · pre-merge
          </span>
          <span
            style={{
              fontSize: 14,
              fontWeight: 700,
              color: v.color,
              background: `${v.color}1a`,
              border: `1px solid ${v.color}55`,
              borderRadius: 8,
              padding: "4px 12px",
            }}
          >
            {v.label}
          </span>
        </div>
        <div
          style={{
            fontSize: isSquare ? 52 : 46,
            fontWeight: 700,
            lineHeight: 1.05,
            letterSpacing: "-0.03em",
            fontFamily: DISPLAY,
            background: "linear-gradient(90deg, #ffffff 0%, #eceae8 55%, #b0aca8 100%)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            backgroundClip: "text",
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {title}
        </div>
        <div style={{ fontSize: 13, color: MUTED, fontFamily: MONO }}>
          {report.changedFiles.length} file{report.changedFiles.length === 1 ? "" : "s"} changed ·{" "}
          {report.testFilesChanged} test file{report.testFilesChanged === 1 ? "" : "s"} in diff
        </div>
      </div>

      {/* The three receipts */}
      <div
        style={{
          display: "flex",
          gap: 2,
          borderRadius: 12,
          background: "rgba(255,255,255,0.04)",
          border: "1px solid rgba(255,255,255,0.08)",
          position: "relative",
        }}
      >
        <Receipt
          value={String(walls)}
          label="load-bearing walls"
          color={walls > 0 ? ORANGE : BONE}
        />
        <div style={{ width: 1, background: "rgba(255,255,255,0.08)" }} />
        <Receipt value={formatNum(report.combinedDependents)} label="files reached" color={BONE} />
        <div style={{ width: 1, background: "rgba(255,255,255,0.08)" }} />
        <Receipt value={testsValue} label={testsLabel} color={testsColor} />
      </div>

      {/* Evidence: the top of the blast */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 10,
          position: "relative",
          flex: 1,
          minHeight: 0,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            fontSize: 11,
            textTransform: "uppercase",
            letterSpacing: "0.12em",
            color: "rgba(255,255,255,0.5)",
          }}
        >
          Top of the blast
        </div>
        {evidence.length === 0 ? (
          <div style={{ fontSize: 14, color: MUTED, fontFamily: MONO }}>
            No production files in the diff.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {evidence.map((f) => (
              <div key={f.file} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span
                  style={{
                    width: 9,
                    height: 9,
                    borderRadius: "50%",
                    background: TIER_COLOR[f.tier] ?? MUTED,
                    flexShrink: 0,
                  }}
                />
                <span
                  style={{
                    fontFamily: MONO,
                    fontSize: isSquare ? 20 : 18,
                    color: BONE,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    flexShrink: 1,
                    minWidth: 0,
                  }}
                >
                  <span style={{ color: "rgba(255,255,255,0.45)" }}>{dirName(f.file)}</span>
                  {baseName(f.file)}
                </span>
                <span
                  style={{
                    fontSize: 12,
                    fontFamily: MONO,
                    color: TIER_COLOR[f.tier] ?? MUTED,
                    whiteSpace: "nowrap",
                  }}
                >
                  {f.tier}
                </span>
                <span style={{ flex: 1 }} />
                <span
                  style={{
                    fontSize: 13,
                    fontFamily: MONO,
                    color: MUTED,
                    whiteSpace: "nowrap",
                  }}
                >
                  {KIND_LABEL[f.kind]} · {f.dependents} dep
                  {f.untestedDependents > 0 ? ` · ${f.untestedDependents} untested` : ""}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          fontSize: 12,
          color: "rgba(255,255,255,0.45)",
          fontFamily: MONO,
          position: "relative",
        }}
      >
        <span>
          {pr.baseRef} ← {pr.headRef}
        </span>
        <span style={{ fontFamily: DISPLAY }}>
          codetrawl.com · what a change reaches, before it merges
        </span>
      </div>
    </div>
  );
}

export { DIMS as BLAST_CARD_DIMS };
