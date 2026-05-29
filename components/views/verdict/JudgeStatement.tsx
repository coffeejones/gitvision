// JudgeStatement — AI bench-statement panel between the verdict hero
// and the department rulings (v0.82+, Phase C-2).
//
// Presentational only. The narrative text is generated server-side
// by lib/intelligence/verdictNarrative.ts and passed in as a prop;
// this component is responsible solely for the visual treatment of
// the text + the small attribution footer ("Bench statement · model
// · generated at"). Renders nothing when text is empty so the
// caller can hide AI when ANTHROPIC_API_KEY is unset without an
// extra conditional.
//
// Tier gating happens on the verdict page, not here — Scout users
// never reach this component since the page short-circuits before
// the AI call.

import { Quote } from "lucide-react";
import { TOK } from "@/lib/theme";

interface Props {
  /** The AI-generated 50-80 word bench statement. */
  text: string;
  /** Model identifier for the attribution footer (e.g.
   *  "claude-haiku-4-5"). */
  model: string;
}

export function JudgeStatement({ text, model }: Props) {
  if (!text) return null;

  return (
    <section
      className="flex flex-col gap-4 rounded-xl p-6"
      style={{
        background: TOK.surface,
        border: `1px solid ${TOK.border}`,
      }}
    >
      <div
        className="flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] font-medium"
        style={{ color: TOK.textMuted }}
      >
        <Quote size={12} />
        <span>Bench statement · generated</span>
      </div>

      {/* The bench statement itself — styled as a deliberate prose
          block, slightly larger than body copy so it reads as a
          distinct artifact rather than a sidebar note. */}
      <p
        className="text-base sm:text-lg leading-relaxed italic"
        style={{
          color: TOK.textPrimary,
          letterSpacing: "-0.005em",
        }}
      >
        {text}
      </p>

      {/* Attribution footer — small, muted. Keeps the "AI wrote this,
          grounded in the deterministic verdict above" trust signal
          present without taking visual weight from the statement. */}
      <div
        className="flex items-center gap-3 text-xs pt-1 mt-1"
        style={{
          color: TOK.textMuted,
          borderTop: `1px solid ${TOK.border}`,
        }}
      >
        <span>{model}</span>
        <span aria-hidden>·</span>
        <span>grounded in the four department rulings above</span>
      </div>
    </section>
  );
}
