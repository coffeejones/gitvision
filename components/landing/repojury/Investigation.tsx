// Investigation — "the verdict is where you start, not where you stop"
// (Phase N; mockups instead of screenshots).
//
// Real TOK-dark product screenshots never sat right against the warm
// forensic-dossier palette — wrapping them four different ways didn't
// fix a fundamental aesthetic clash. So these feature views are
// hand-built mockups in the dossier palette (paper / brass / mono /
// noir), the same approach as Exhibit A (the dependency graph in
// VerdictFull). They evoke the real workspace — blast radius, signal
// evidence, the security scanners — while belonging to the page.
//
// Server component, no images.

import type { ReactNode } from "react";
import { Reveal } from "../Reveal";
import { BlastRadiusMock, SignalsMock, SecurityMock } from "./featureMocks";

type Feature = {
  no: string;
  tag: string;
  title: string;
  body: string;
  mock: ReactNode;
};

const FEATURES: Feature[] = [
  {
    no: "Exhibit B",
    tag: "Forensics Lab · Blast radius",
    title: "Know what breaks before you touch it",
    body: "Pick any file and trace its blast radius — every module that depends on it, and everything it leans on. Refactor with the whole picture instead of a guess.",
    mock: <BlastRadiusMock />,
  },
  {
    no: "Exhibit C",
    tag: "Health Department · Signals",
    title: "Every signal, with the evidence",
    body: "All 20 deterministic signals, sorted into what's working, what needs work, and open questions. Each one carries the file paths and numbers behind it — nothing asserted without proof you can open.",
    mock: <SignalsMock />,
  },
  {
    no: "Exhibit D",
    tag: "Security Bureau · Scanners",
    title: "A security review you can trust",
    body: "Three deterministic scanners — supply-chain incidents, leaked secrets, risky patterns. No AI guesses: every finding maps back to a documented advisory or a literal match in your code.",
    mock: <SecurityMock />,
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

        {FEATURES.map((f, i) => (
          <Reveal
            key={f.no}
            className={`feature-row${i % 2 === 1 ? " flip" : ""}`}
          >
            <div className="feature-shot-wrap">
              <span className="feature-exhibit">{f.no}</span>
              {f.mock}
            </div>
            <div className="feature-copy">
              <span className="feature-tag">{f.tag}</span>
              <h3>{f.title}</h3>
              <p>{f.body}</p>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}
