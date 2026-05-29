// Chain of custody — privacy reframed as evidence handling. Three
// stages: sealed intake, examination, destruction. The final card is
// marked .void and gets a DESTROYED stamp.

import type { ReactNode } from "react";
import { Reveal } from "../Reveal";

type Stage = {
  no: string;
  tone: "ok" | "gone";
  chip: string;
  title: string;
  body: ReactNode;
  log: ReactNode;
  void?: boolean;
};

const STAGES: Stage[] = [
  {
    no: "01",
    tone: "ok",
    chip: "Sealed",
    title: "Intake, sealed",
    body: (
      <>
        Cloned in-memory into an isolated worker — <span className="redact">no other process</span> can reach it.
      </>
    ),
    log: (
      <>
        <b>10:42:01</b> · clone --in-memory · sealed
      </>
    ),
  },
  {
    no: "02",
    tone: "ok",
    chip: "In-memory",
    title: "Examined under seal",
    body: (
      <>
        AST, history, and deps are read once. Nothing is <span className="redact">copied or trained on</span>, ever.
      </>
    ),
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
    body: "The worker is torn down. Source is gone — only the verdict and exhibits survive.",
    log: (
      <>
        <b>10:42:11</b> · destroy() · 0 bytes retained
      </>
    ),
    void: true,
  },
];

export function Custody() {
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
            Source enters a sealed sandbox, gets examined, and is destroyed the moment the verdict is returned. We
            keep the findings — never the files.
          </p>
        </Reveal>
        <Reveal className="custody">
          {STAGES.map((s) => (
            <div className={`cu${s.void ? " void" : ""}`} key={s.no}>
              <div className={`cu-strip ${s.tone}`} />
              <div className="cu-body">
                <div className="cu-head">
                  <span className="cu-seal">{s.no}</span>
                  <span className={`cu-chip ${s.tone}`}>{s.chip}</span>
                </div>
                <h4>{s.title}</h4>
                <p>{s.body}</p>
                <div className="cu-log">{s.log}</div>
              </div>
            </div>
          ))}
        </Reveal>
      </div>
    </section>
  );
}
