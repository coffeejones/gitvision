// Investigation — "the verdict is where you start, not stop" (Phase N).
//
// The section the landing was missing. Persona testing (10/10) read
// the page as a one-shot "paste URL → get a score → leave" tool
// because the workspace — the reason you come back — was buried in the
// pricing table. This section makes the investigation the promise:
// trace every signal to its evidence, see the structure, know what to
// fix, and come back to watch it change. The verdict is the hook; this
// is the product.
//
// Server component. Glyphs match the Trial section's stroke style.

import type { ReactNode } from "react";
import { Reveal } from "../Reveal";

type Move = { glyph: ReactNode; title: string; body: string };

const MOVES: Move[] = [
  {
    glyph: (
      <>
        <circle cx="11" cy="11" r="7" />
        <path d="M16 16l5 5" strokeWidth={2} />
      </>
    ),
    title: "Trace every signal to its evidence",
    body: "Open any department and see all of it — not just the headline finding. Each one carries its file path, the exact numbers, and a link to the advisory or the line of code behind it. Nothing is asserted without evidence you can open.",
  },
  {
    glyph: (
      <>
        <circle cx="6" cy="6" r="2.4" />
        <circle cx="18" cy="6" r="2.4" />
        <circle cx="12" cy="18" r="2.4" />
        <path d="M7.6 7.6 10.8 16M16.4 7.6 13.2 16" />
      </>
    ),
    title: "See the structure, not just the score",
    body: "Auto-extracted architecture diagrams, dependency graphs, and the hotspots taking all the churn. Walk your codebase the way a new hire wishes they could — and actually understand how it fits together.",
  },
  {
    glyph: (
      <>
        <path d="M9 6h11M9 12h11M9 18h11" />
        <path d="M4 6l1.2 1.2L7.4 5M4 12l1.2 1.2L7.4 11" strokeWidth={1.8} />
      </>
    ),
    title: "Know what to fix first",
    body: "Findings are ranked by what actually moves the needle. Each tells you why it landed and what it would take to clear it — so the verdict isn't a grade you can't act on, it's a to-do list you understand.",
  },
  {
    glyph: (
      <>
        <path d="M4 8h12l-3.5-3.5" />
        <path d="M20 16H8l3.5 3.5" />
      </>
    ),
    title: "Come back and watch it change",
    body: "Re-run any time. “Since your last visit” shows exactly what improved, what regressed, and what's new — so you can watch the case turn in your favor as you ship.",
  },
];

export function Investigation() {
  return (
    <section className="section-pad spot" id="investigate">
      <div className="wrap">
        <Reveal className="sec-head">
          <span className="eyebrow">
            After the verdict · the case file opens
          </span>
          <h2 className="display">
            The verdict is where you
            <br />
            start, not where you stop.
          </h2>
          <p className="lede">
            A grade tells you something&rsquo;s wrong. The case file shows you
            what, where, and why — then lets you dig until you understand your
            codebase, not just its score. That&rsquo;s the part you come back
            to.
          </p>
        </Reveal>
        <Reveal className="invest-grid">
          {MOVES.map((m) => (
            <div className="invest-card" key={m.title}>
              <div className="invest-glyph">
                <svg
                  width="22"
                  height="22"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.6}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  {m.glyph}
                </svg>
              </div>
              <h3>{m.title}</h3>
              <p>{m.body}</p>
            </div>
          ))}
        </Reveal>
      </div>
    </section>
  );
}
