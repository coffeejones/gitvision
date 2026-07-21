// VerdictHero — top of /session/[id]/verdict (v0.82+, Phase C / L).
//
// Renders the deterministic verdict as a large court-themed seal at
// the top of the page. Two-column layout:
//   left  — score ring + letter grade (mirrors the landing page's
//           VerdictDoc, so brand promise survives from marketing
//           through to product)
//   right — eyebrow, outcome label, micro-line, summary
//
// The seal is keyed to the outcome by TONE: Clear = neutral bone,
// Conditional = neutral dim, Flagged = International Orange (the one
// rationed heat). The same colour drives the score-ring stroke so the
// visual reads as one composed artefact, not two stuck-together panels.
//
// Server-rendered. The ring is static SVG with strokeDasharray/
// strokeDashoffset set from the score — no client component or
// useEffect needed (the landing's count-up is marketing flourish;
// in-product we show the final number).

import type { Verdict } from "@/lib/intelligence/verdict";
import { TOK } from "@/lib/sessionTheme";
import { Gauge } from "lucide-react";
import { VerdictScoreRing } from "./VerdictScoreRing";

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
    // accent is the neutral brand tone (bone) — reusing keeps the grade
    // visually coherent with the rest of the workspace's "good" state
    // (Health-at-a-Glance healthy tiles read in the same neutral tone).
    fg: TOK.accent,
    bg: TOK.accentSoft,
    border: TOK.accent,
    micro: "Clear across all four lenses",
  },
  conditional: {
    fg: TOK.amber,
    bg: TOK.amberSoft,
    border: TOK.amber,
    micro: "Passed, with conditions to watch",
  },
  returned: {
    fg: TOK.rose,
    bg: TOK.roseSoft,
    border: TOK.rose,
    micro: "Flagged by at least one lens",
  },
};

export function VerdictHero({ verdict }: Props) {
  const style = STYLE_BY_OUTCOME[verdict.outcome];

  return (
    <section
      className="flex flex-col sm:flex-row gap-8 sm:gap-10 items-start sm:items-center rounded-xl p-8"
      style={{
        background: style.bg,
        border: `1px solid ${style.border}`,
      }}
    >
      {/* Four-segment score ring (Phase 3) — one arc per lens, colored by its
          vote, lens name on its quarter, center grade in the outcome color.
          Replaces the single-arc ring so the grade's composition ("three
          cleared, Supply flagged → capped") is visible, not just described. */}
      <div className="shrink-0 w-full sm:w-auto flex justify-center">
        <VerdictScoreRing verdict={verdict} />
      </div>

      {/* Right column: eyebrow + outcome label + micro + summary. */}
      <div className="flex flex-col gap-4 min-w-0">
        <div
          className="flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] font-medium"
          style={{ color: style.fg }}
        >
          <Gauge size={12} />
          <span>Final grade</span>
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
            {verdict.outcome === "returned" ? "flagged" : "conditional"} grade
            can&apos;t outrank itself —{" "}
            {verdict.outcome === "returned"
              ? "a lens failed"
              : "a lens raised concerns"}
            , so the letter stays in{" "}
            {verdict.outcome === "returned" ? "needs-work" : "non-clear"}{" "}
            territory.
          </p>
        )}
      </div>
    </section>
  );
}
