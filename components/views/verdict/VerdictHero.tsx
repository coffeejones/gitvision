// VerdictHero — top of /session/[id]/verdict (v0.82+, Phase C).
//
// Renders the deterministic verdict as a large court-themed seal at
// the top of the page. The seal is color-keyed to the outcome
// (Cleared = emerald, Conditional Approval = amber, Returned =
// rose) and is followed by the one-sentence summary computed from
// the four department votes.
//
// Phase C-1 ships the deterministic-only path; the AI narrative
// (Phase C-2) lands as an additional paragraph below the summary
// without changing this component's shape.

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

export function VerdictHero({ verdict }: Props) {
  const style = STYLE_BY_OUTCOME[verdict.outcome];

  return (
    <section
      className="flex flex-col gap-5 rounded-xl p-8"
      style={{
        background: style.bg,
        border: `1px solid ${style.border}`,
      }}
    >
      {/* Eyebrow with gavel icon — small but consistent with the
          court-room visual language. */}
      <div
        className="flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] font-medium"
        style={{ color: style.fg }}
      >
        <Gavel size={12} />
        <span>Final Verdict</span>
      </div>

      {/* Outcome label — the largest text on the page. */}
      <h2
        className="text-5xl sm:text-6xl font-semibold tracking-tight"
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
    </section>
  );
}
