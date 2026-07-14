// CTComputed — the determinism contrast, two hairline columns: what the
// machine computes vs what the model is allowed to do. This is the page's
// sharpest positioning section (the verified market gap: deterministic
// judgment + grounded narration), so it's all type and rules — no accent,
// no illustration. The payoff line is the section header itself.

import { CTReveal } from "./CTReveal";

const MACHINE = [
  "Runs the sweep — git history, ASTs, dependency graphs, security scans",
  "Computes every signal and the grade — deterministically",
  "Same input, same survey — re-run it and diff the results",
  "Stamps every claim with a signal id you can follow to the evidence",
];

const MODEL = [
  "Writes the briefing — plain language over computed signals",
  "Cites only what the sweep measured — nothing invented",
  "Never scores, never decides, never overrides a signal",
  "Optional — the survey stands complete without it",
];

export function CTComputed() {
  return (
    <section className="section computed">
      <div className="wrap">
        <CTReveal className="rv-block">
          <h2 className="sec-h2">AI narrates. It never decides.</h2>
        </CTReveal>
        <CTReveal>
          <div className="comp-cols">
            {[
              { head: "computed by the machine", items: MACHINE },
              { head: "allowed for the model", items: MODEL },
            ].map((col, c) => (
              <div className="comp-col" key={col.head}>
                <span
                  className="comp-head rv-i"
                  style={{ transitionDelay: `${c * 120}ms` }}
                >
                  {col.head}
                </span>
                <ul>
                  {col.items.map((m, i) => (
                    <li
                      className="rv-i"
                      key={m}
                      style={{ transitionDelay: `${c * 120 + 100 + i * 90}ms` }}
                    >
                      {m}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </CTReveal>
        {/* Answers the privacy + private-repo questions the panel raised
            (oss-maintainer, eng-manager, staff-eng) — only what's true. */}
        <CTReveal className="rv-block">
          <p className="trust-line">
            Repos are cloned in memory, read once, and discarded — we keep the
            findings, never your files. Public or private, your sweep is free.
          </p>
          <a href="#analyze" className="ct-cta-ghost">
            Analyze a repo
          </a>
        </CTReveal>
      </div>
    </section>
  );
}
