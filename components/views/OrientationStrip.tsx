// OrientationStrip — the shared page-header for every workspace tab (Phase 2 / Move B).
//
// The 10-second orientation gap: several tabs drop a junior straight into a
// dense panel with no "what am I looking at, what do I do first" line. This
// formalizes the pattern the Code tab already got right (eyebrow → title →
// plain lead) into one component so all 7 read as one voice, and adds a slot
// for the rollup posture bar (Move E) directly under the lead.
//
// Voice contract (enforced by the copy, not the component): the lead is one or
// two sentences — beat 1 says what the surface shows, beat 2 is always
// "Start with …" + one concrete first click. Caveats live in the rollup, never
// the lead.
//
// Composition is flexible so one component fits both header shapes:
//   - Panel-only tabs (PRs, Security, Faultline, …) pass eyebrow + title + line.
//   - Overview passes only line + rollup — its editorial hero already owns the
//     eyebrow + name, so repeating them here would be noise.
//
// `rollup` is a SLOT, not baked in: each surface pulls different fields and
// three of seven omit it conditionally, so the strip just renders whatever
// node it's handed (or nothing, collapsing cleanly) and never owns the data or
// its colors.

import type { ReactNode } from "react";
import { TOK } from "@/lib/sessionTheme";

interface Props {
  /** Uppercase, tracked eyebrow — mirrors the nav label. Omitted on Overview,
   *  whose hero already carries the identity. */
  eyebrow?: string;
  /** Optional h1. Panel-only tabs set it; Overview leaves it to the hero. */
  title?: string;
  /** The plain-language "what am I looking at + what to do" line. ReactNode so
   *  it can carry inline emphasis / quoted column names / a TermInfo. */
  line: ReactNode;
  /** Optional rollup posture node (RollupBar / RollupCounts). undefined =
   *  render nothing, no leftover gap. */
  rollup?: ReactNode;
  /** Max width for the lead paragraph so long lines wrap at a readable measure. */
  leadMax?: string;
}

export function OrientationStrip({
  eyebrow,
  title,
  line,
  rollup,
  leadMax = "44rem",
}: Props) {
  return (
    <header className="flex flex-col gap-4">
      {eyebrow && (
        <span
          className="text-[10px] uppercase tracking-[0.18em] font-medium"
          style={{ color: TOK.textMuted }}
        >
          {eyebrow}
        </span>
      )}
      {title && (
        <h1
          className="text-3xl sm:text-4xl font-semibold tracking-tight"
          style={{
            color: TOK.textPrimary,
            letterSpacing: "-0.025em",
            lineHeight: 1.1,
          }}
        >
          {title}
        </h1>
      )}
      <p
        className="text-sm sm:text-base leading-relaxed"
        style={{ color: TOK.textSecondary, maxWidth: leadMax }}
      >
        {line}
      </p>
      {rollup}
    </header>
  );
}
