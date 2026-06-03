// VerdictHero — top of /session/[id]/verdict (v0.82+, Phase C / L).
//
// Renders the deterministic verdict as a large court-themed seal at
// the top of the page. Two-column layout:
//   left  — score ring + letter grade (mirrors the landing page's
//           VerdictDoc, so brand promise survives from marketing
//           through to product)
//   right — eyebrow, outcome label, micro-line, summary
//
// The seal is color-keyed to the outcome (Cleared = emerald,
// Conditional Approval = amber, Returned = rose). The same colour
// drives the score-ring stroke so the visual reads as one composed
// artefact rather than two stuck-together panels.
//
// Server-rendered. The ring is static SVG with strokeDasharray/
// strokeDashoffset set from the score — no client component or
// useEffect needed (the landing's count-up is marketing flourish;
// in-product we show the final number).

import type { Verdict } from "@/lib/intelligence/verdict";
import { TOK } from "@/lib/theme";
import { Gavel } from "lucide-react";

interface Props {
  verdict: Verdict;
}

interface OutcomeStyle {
  /** Foreground color for label + accents. */
  fg: string;
  /** Background color for the seal box. Lower alpha = softer. */
  bg: string;
  /** Border color matching the foreground. */
  border: string;
  /** Short imperative below the label (e.g. "Approved", "Conditions
   *  apply"). Reinforces what the outcome means without rephrasing
   *  the deterministic summary. */
  micro: string;
}

const STYLE_BY_OUTCOME: Record<Verdict["outcome"], OutcomeStyle> = {
  cleared: {
    // accent is the brand emerald family — reusing keeps the verdict
    // visually coherent with the rest of the workspace's "good"
    // state (Health-at-a-Glance healthy tiles use the same hue).
    fg: TOK.accent,
    bg: TOK.accentSoft,
    border: TOK.accent,
    micro: "Approved by all four departments",
  },
  conditional: {
    fg: TOK.amber,
    bg: TOK.amberSoft,
    border: TOK.amber,
    micro: "Approved with conditions attached",
  },
  returned: {
    fg: TOK.rose,
    bg: TOK.roseSoft,
    border: TOK.rose,
    micro: "Returned for revision before approval",
  },
};

// Geometry for the score ring. r = 52 → 2πr ≈ 327 (matches the
// landing's VerdictDoc so the in-product ring reads as the same
// artefact). Track + arc share the same circle path; dash math
// trims the arc to the score percentage.
const RING_R = 52;
const RING_CIRC = 2 * Math.PI * RING_R;

export function VerdictHero({ verdict }: Props) {
  const style = STYLE_BY_OUTCOME[verdict.outcome];
  const arcOffset = RING_CIRC - (RING_CIRC * verdict.score) / 100;

  return (
    <section
      className="flex flex-col sm:flex-row gap-8 sm:gap-10 items-start sm:items-center rounded-xl p-8"
      style={{
        background: style.bg,
        border: `1px solid ${style.border}`,
      }}
    >
      {/* Score ring + grade — mirrors the landing's VerdictDoc score
          panel. r=52 + strokeWidth=9 matches the marketing artefact
          exactly so users recognise the metric across surfaces. */}
      <div className="relative shrink-0">
        <svg
          width={138}
          height={138}
          viewBox="0 0 138 138"
          aria-label={`Verdict score ${verdict.score} out of 100, grade ${verdict.grade}`}
        >
          {/* Background track — neutral, lets the colored arc do the work. */}
          <circle
            cx={69}
            cy={69}
            r={RING_R}
            fill="none"
            stroke={TOK.border}
            strokeWidth={9}
          />
          {/* Score arc — starts at top (rotated -90°) and sweeps
              clockwise to verdict.score%. */}
          <circle
            cx={69}
            cy={69}
            r={RING_R}
            fill="none"
            stroke={style.fg}
            strokeWidth={9}
            strokeLinecap="round"
            strokeDasharray={RING_CIRC}
            strokeDashoffset={arcOffset}
            transform="rotate(-90 69 69)"
          />
        </svg>
        {/* Grade + score number positioned absolute in the ring's
            center. Two-line stack so the grade reads as the headline
            and the n/100 reads as the supporting detail. */}
        <div
          className="absolute inset-0 flex flex-col items-center justify-center"
          aria-hidden
        >
          <span
            className="text-4xl font-semibold leading-none"
            style={{ color: style.fg, letterSpacing: "-0.02em" }}
          >
            {verdict.grade}
          </span>
          <span
            className="text-xs font-mono mt-1.5 tabular-nums"
            style={{ color: TOK.textMuted }}
          >
            {verdict.score}/100
          </span>
        </div>
      </div>

      {/* Right column: eyebrow + outcome label + micro + summary. */}
      <div className="flex flex-col gap-4 min-w-0">
        <div
          className="flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] font-medium"
          style={{ color: style.fg }}
        >
          <Gavel size={12} />
          <span>Final Verdict</span>
        </div>

        {/* Outcome label — the largest text on the page. */}
        <h2
          className="text-4xl sm:text-5xl font-semibold tracking-tight"
          style={{
            color: style.fg,
            letterSpacing: "-0.03em",
            lineHeight: 1.05,
          }}
        >
          {verdict.outcomeLabel}.
        </h2>

        {/* Micro-line directly under the label — a 4-6 word
            context-setting phrase before the longer summary. */}
        <p
          className="text-sm font-medium"
          style={{ color: style.fg, opacity: 0.85 }}
        >
          {style.micro}
        </p>

        {/* Deterministic one-sentence summary — same string used as
            grounding input for the AI narrative in Phase C-2. */}
        <p
          className="text-base sm:text-lg leading-relaxed max-w-2xl"
          style={{ color: TOK.textPrimary }}
        >
          {verdict.summary}
        </p>

        {/* Grade math — when the score was gated by the ruling, say so, so
            the letter grade never looks arbitrary ("30 against what?"). The
            raw vote-sum is shown for transparency. */}
        {verdict.score < verdict.rawScore && (
          <p className="text-xs leading-relaxed" style={{ color: TOK.textMuted }}>
            Grade capped at {verdict.grade}: the raw vote-sum is{" "}
            {verdict.rawScore}/100, but a{" "}
            {verdict.outcome === "returned" ? "returned" : "conditional"} ruling
            can&apos;t outrank itself — a department was flagged, so the letter
            stays in {verdict.outcome === "returned" ? "needs-work" : "non-clear"}{" "}
            territory.
          </p>
        )}
      </div>
    </section>
  );
}
