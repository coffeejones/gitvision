// Investigation — "the verdict is where you start, not where you stop"
// (Phase N; reworked to focused feature rows).
//
// Persona testing said the page read as a one-shot grader because the
// workspace was never shown. First attempt (full-workspace polaroids
// on a manila folder) looked unrealistic and the shots were too small
// to read. This version shows tight, legible crops of the actual
// product — blast radius, signal evidence, the security scanners — as
// alternating feature rows, each tagged with a brass exhibit label.
// Real screenshots, presented straight, inside the dossier palette.
//
// Server component. Crops captured from the analyzed colinhacks/zod
// case (Exhibit A is the dependency graph in VerdictFull).

import { Reveal } from "../Reveal";

type Feature = {
  no: string;
  tag: string;
  title: string;
  body: string;
  src: string;
  alt: string;
};

const FEATURES: Feature[] = [
  {
    no: "Exhibit B",
    tag: "Forensics Lab · Blast radius",
    title: "Know what breaks before you touch it",
    body: "Pick any file and trace its blast radius — every module that depends on it, and everything it leans on. Refactor with the whole picture instead of a guess.",
    src: "/shots/feature-blast.png",
    alt: "RepoJury blast-radius view — incoming and outgoing dependencies for a single file",
  },
  {
    no: "Exhibit C",
    tag: "Health Department · Signals",
    title: "Every signal, with the evidence",
    body: "All 20 deterministic signals, sorted into what's working, what needs work, and open questions. Each one carries the file paths and numbers behind it — nothing asserted without proof you can open.",
    src: "/shots/feature-signals.png",
    alt: "RepoJury signals view — deterministic signals with file paths and numbers as evidence",
  },
  {
    no: "Exhibit D",
    tag: "Security Bureau · Scanners",
    title: "A security review you can trust",
    body: "Three deterministic scanners — supply-chain incidents, leaked secrets, risky patterns. No AI guesses: every finding maps back to a documented advisory or a literal match in your code.",
    src: "/shots/feature-security.png",
    alt: "RepoJury security view — three deterministic scanners with clean status",
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
              <figure className="feature-shot">
                <img src={f.src} alt={f.alt} loading="lazy" />
              </figure>
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
