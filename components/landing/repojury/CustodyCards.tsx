// CustodyCards — Chain of custody as three refined cards (V2).
//
// Jonas preferred the original three-card row over the single-document
// treatment — but the originals (Custody.tsx) read flat next to the
// Process panels: thin noir boxes, redaction bars that looked like
// load errors, no craft. This keeps the three-card layout but lifts it
// to match the rest of V2: the same gridded noir-panel stock as the
// feature mockups, an embossed stage seal, clean prose (no redaction),
// a mono custody log, and a DESTROYED stamp on the final card. The
// green→amber→red tones carry the sealed → examined → destroyed arc.
//
// Used by RepoJuryV2 (/preview) only — V1's Custody.tsx is untouched.

import type { ReactNode } from "react";
import { Reveal } from "../Reveal";

type Stage = {
  no: string;
  tone: "ok" | "warn" | "gone";
  chip: string;
  title: string;
  body: string;
  log: ReactNode;
  void?: boolean;
};

const STAGES: Stage[] = [
  {
    no: "01",
    tone: "ok",
    chip: "Sealed",
    title: "Intake, sealed",
    body: "Cloned into an isolated in-memory worker. No other process can reach it.",
    log: (
      <>
        <b>10:42:01</b> · clone --in-memory · sealed
      </>
    ),
  },
  {
    no: "02",
    tone: "warn",
    chip: "Read-only",
    title: "Examined under seal",
    body: "AST, git history and dependencies are read once — never copied, never trained on.",
    log: (
      <>
        <b>10:42:09</b> · 4 departments · read-only
      </>
    ),
  },
  {
    no: "03",
    tone: "gone",
    chip: "Purged",
    title: "Evidence destroyed",
    body: "The worker is torn down. Source is gone — only the verdict and its exhibits survive.",
    log: (
      <>
        <b>10:42:11</b> · destroy() · 0 bytes retained
      </>
    ),
    void: true,
  },
];

export function CustodyCards() {
  return (
    <section className="section-pad spot" id="custody">
      <div className="wrap">
        <Reveal className="sec-head">
          <span className="eyebrow">Chain of custody · evidence handling</span>
          <h2 className="display">
            Your code is evidence.
            <br />
            It&rsquo;s treated like it.
          </h2>
          <p className="lede">
            Source enters a sealed sandbox, gets examined, and is destroyed
            the moment the verdict is returned. We keep the findings — never
            the files.
          </p>
        </Reveal>
        <Reveal className="cv-grid">
          {STAGES.map((s) => (
            <div className={`cv ${s.tone}${s.void ? " void" : ""}`} key={s.no}>
              <div className="cv-top">
                <span className="cv-seal">{s.no}</span>
                <span className={`cv-chip ${s.tone}`}>{s.chip}</span>
              </div>
              <h4>{s.title}</h4>
              <p>{s.body}</p>
              <div className="cv-log">{s.log}</div>
            </div>
          ))}
        </Reveal>
      </div>
    </section>
  );
}
