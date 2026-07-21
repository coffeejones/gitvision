// VerdictScoreRing — the four-segment score ring for the verdict hero (Phase 3).
//
// Replaces the single-arc ring (which only showed the score MAGNITUDE in one
// color) with one arc per lens, colored by that lens's vote, and the lens name
// sitting on its own quarter. This makes the composition of the grade literal:
// "three lenses cleared, but Supply flagged, so the grade is capped" is
// something you SEE, not a paragraph you read. The center grade takes the
// outcome color (= the worst vote), so a single flagged lens visibly drags the
// whole grade into orange territory — the cap made visual.
//
// Pure SVG, server-rendered (no client component). Colors come from the session
// palette (bone = clear, gold = conditional, International Orange = flagged),
// honoring the rationed-heat system: orange only appears on a genuine fail.
//
// Geometry: four 90° sectors from the top, clockwise, in the canonical ruling
// order (Health, Security, Forensics, Supply). A small gap separates them so
// each vote reads as its own arc.

import type { Verdict, Vote } from "@/lib/intelligence/verdict";
import { TOK } from "@/lib/sessionTheme";

const VOTE_COLOR: Record<Vote, string> = {
  pass: TOK.accent, // bone — clear
  conditional: TOK.amber, // muted caution gold
  fail: TOK.rose, // International Orange — the rationed heat
};

const OUTCOME_COLOR: Record<Verdict["outcome"], string> = {
  cleared: TOK.accent,
  conditional: TOK.amber,
  returned: TOK.rose,
};

/** 0° = top, sweeping clockwise. */
function polar(cx: number, cy: number, r: number, deg: number): [number, number] {
  const a = ((deg - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}

function arcPath(
  cx: number,
  cy: number,
  r: number,
  startDeg: number,
  endDeg: number
): string {
  const [x1, y1] = polar(cx, cy, r, startDeg);
  const [x2, y2] = polar(cx, cy, r, endDeg);
  const large = endDeg - startDeg <= 180 ? 0 : 1;
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}

interface Props {
  verdict: Verdict;
  /** Ring diameter (the arc circle), not counting the label margin. */
  ringD?: number;
}

export function VerdictScoreRing({ verdict, ringD = 200 }: Props) {
  const lenses = verdict.rulings; // exactly 4, canonical order
  const padX = 108; // room for the corner labels
  const padY = 44;
  const vbW = ringD + padX * 2;
  const vbH = ringD + padY * 2;
  const cx = vbW / 2;
  const cy = vbH / 2;
  const stroke = Math.round(ringD * 0.062);
  const r = ringD / 2 - stroke / 2 - 2;
  const gap = 7; // degrees between sectors
  const seg = 90 - gap;
  const labelR = r + stroke / 2 + 20;
  const gradeColor = OUTCOME_COLOR[verdict.outcome];

  const ariaLabel = `Grade ${verdict.grade}, score ${verdict.score} out of 100. ${lenses
    .map((l) => `${l.title} ${l.voteLabel}`)
    .join(", ")}.`;

  return (
    <svg
      width={vbW}
      height={vbH}
      viewBox={`0 0 ${vbW} ${vbH}`}
      style={{ maxWidth: "100%", height: "auto" }}
      role="img"
      aria-label={ariaLabel}
    >
      {/* Neutral full track — lets the colored votes do the work. */}
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={TOK.border} strokeWidth={stroke} />

      {/* One arc per lens, colored by its vote. */}
      {lenses.map((l, i) => {
        const start = i * 90 + gap / 2;
        return (
          <path
            key={l.id}
            d={arcPath(cx, cy, r, start, start + seg)}
            fill="none"
            stroke={VOTE_COLOR[l.vote]}
            strokeWidth={stroke}
            strokeLinecap="butt"
          />
        );
      })}

      {/* Lens name + vote on each quarter — the spatial arc↔lens mapping. */}
      {lenses.map((l, i) => {
        const mid = i * 90 + 45;
        const [lx, ly] = polar(cx, cy, labelR, mid);
        const anchor = mid < 180 ? "start" : "end";
        return (
          <text key={l.id} x={lx} y={ly} textAnchor={anchor}>
            <tspan style={{ fontSize: 14, fontWeight: 500, fill: TOK.textPrimary }}>
              {l.title}
            </tspan>
            <tspan
              x={lx}
              dy="1.35em"
              style={{
                fontSize: 10.5,
                fill: VOTE_COLOR[l.vote],
                letterSpacing: "0.08em",
                textTransform: "uppercase",
              }}
            >
              {l.voteLabel}
            </tspan>
          </text>
        );
      })}

      {/* Center: the letter grade (in the outcome color) + the score. */}
      <text
        x={cx}
        y={cy - 4}
        textAnchor="middle"
        dominantBaseline="central"
        style={{
          fontSize: ringD * 0.28,
          fontWeight: 600,
          fill: gradeColor,
          letterSpacing: "-0.03em",
        }}
      >
        {verdict.grade}
      </text>
      <text
        x={cx}
        y={cy + ringD * 0.15}
        textAnchor="middle"
        dominantBaseline="central"
        style={{
          fontSize: ringD * 0.072,
          fill: TOK.textMuted,
          fontFamily: "var(--font-ct-mono, ui-monospace, monospace)",
        }}
      >
        {verdict.score} / 100
      </text>
    </svg>
  );
}
