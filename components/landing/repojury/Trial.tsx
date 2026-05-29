// How the trial works — three moves from URL to verdict.

import type { ReactNode } from "react";
import { Reveal } from "../Reveal";

type Step = { no: string; title: string; body: string; glyph: ReactNode };

const STEPS: Step[] = [
  {
    no: "MOVE 01",
    title: "File the case",
    body: "Paste a public URL or connect a private repo with a read-only token. The docket opens instantly.",
    glyph: <path d="M5 4h9l5 5v11H5z M14 4v5h5" />,
  },
  {
    no: "MOVE 02",
    title: "Departments investigate",
    body: "All four run in an isolated lab — parsing the AST, walking the git history, weighing every dependency.",
    glyph: (
      <>
        <circle cx="11" cy="11" r="7" />
        <path d="M16 16l5 5" strokeWidth={2} />
      </>
    ),
  },
  {
    no: "MOVE 03",
    title: "The verdict",
    body: "Evidence aggregates into a single score with every exhibit attached. Re-runnable, diffed since last visit.",
    glyph: <path d="M12 3v18M5 7h14M7 7l-3 7h6z M17 7l-3 7h6z" />,
  },
];

export function Trial() {
  return (
    <section className="section-pad spot brass" id="trial">
      <div className="wrap">
        <Reveal className="sec-head">
          <span className="eyebrow">How the trial works · intake to verdict</span>
          <h2 className="display">
            From URL to verdict
            <br />
            in three moves.
          </h2>
        </Reveal>
        <Reveal className="trial">
          {STEPS.map((s) => (
            <div className="step" key={s.no}>
              <div className="step-glyph">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}>
                  {s.glyph}
                </svg>
              </div>
              <div className="step-no">{s.no}</div>
              <h4>{s.title}</h4>
              <p>{s.body}</p>
            </div>
          ))}
        </Reveal>
      </div>
    </section>
  );
}
