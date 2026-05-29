// The Departments — four lit dossier cards, each with a brass seal,
// a mandate, and one real sample finding stamped CLEARED / CAUTION /
// FLAGGED on warm evidence paper.

import type { ReactNode } from "react";
import { Reveal } from "../Reveal";

function DeptSeal({ children }: { children: ReactNode }) {
  return (
    <svg className="seal" width={34} height={34} viewBox="0 0 40 40" fill="none" stroke="url(#brass)" strokeWidth={1.3} aria-hidden>
      {children}
    </svg>
  );
}

type Dept = {
  no: string;
  name: string;
  mandate: string;
  seal: ReactNode;
  tone: "ok" | "warn" | "bad";
  toneLabel: string;
  exhibit: string;
  finding: ReactNode;
};

const DEPTS: Dept[] = [
  {
    no: "DEPT. 01",
    name: "Health Department",
    mandate: "Complexity, duplication, and architectural drift — the slow rot that never shows in a diff.",
    seal: (
      <>
        <circle cx="20" cy="20" r="16" />
        <path d="M20 12v16M12 20h16" strokeWidth={2.4} />
      </>
    ),
    tone: "warn",
    toneLabel: "Caution",
    exhibit: "Exhibit · health-014",
    finding: (
      <>
        payments/ledger.ts — 1,240 LOC, cyclomatic 58.
        <br />
        3× duplicated rounding logic.
      </>
    ),
  },
  {
    no: "DEPT. 02",
    name: "Security Bureau",
    mandate: "Secrets, risky patterns, and known CVEs riding in through your dependencies.",
    seal: (
      <>
        <circle cx="20" cy="20" r="16" />
        <path d="M20 11l7 3v6c0 5-3 7-7 9-4-2-7-4-7-9v-6z" />
      </>
    ),
    tone: "ok",
    toneLabel: "Cleared",
    exhibit: "Exhibit · sec-002",
    finding: (
      <>
        No secrets in history. 0 critical CVEs.
        <br />
        1 advisory pinned, mitigated.
      </>
    ),
  },
  {
    no: "DEPT. 03",
    name: "Forensics Lab",
    mandate: "Git archaeology: who knows what, bus factor, and untested hotspots taking all the churn.",
    seal: (
      <>
        <circle cx="20" cy="20" r="16" />
        <circle cx="17" cy="17" r="6" />
        <path d="M21.5 21.5L28 28" strokeWidth={2.2} />
      </>
    ),
    tone: "bad",
    toneLabel: "Flagged",
    exhibit: "Exhibit · forensics-021",
    finding: (
      <>
        auth/session.ts — bus factor 1.
        <br />
        62 commits, 1 author, 0 tests.
      </>
    ),
  },
  {
    no: "DEPT. 04",
    name: "Supply Office",
    mandate: "Dependency health and transitive risk — the third-party code you ship without reading.",
    seal: (
      <>
        <circle cx="20" cy="20" r="16" />
        <path d="M12 16l8-4 8 4v8l-8 4-8-4z M12 16l8 4 8-4 M20 20v8" />
      </>
    ),
    tone: "ok",
    toneLabel: "Cleared",
    exhibit: "Exhibit · supply-007",
    finding: (
      <>
        214 deps, 198 current.
        <br />
        No abandoned packages on critical path.
      </>
    ),
  },
];

export function Departments() {
  return (
    <section className="section-pad spot" id="departments">
      <div className="wrap">
        <Reveal className="sec-head">
          <span className="eyebrow">The departments · four lines of inquiry</span>
          <h2 className="display">
            Four investigators.
            <br />
            One case file.
          </h2>
          <p className="lede">
            Each department examines a different surface of your repo and files evidence. Nothing is asserted
            without a finding behind it.
          </p>
        </Reveal>
        <Reveal className="dept-grid">
          {DEPTS.map((d) => (
            <div className="dept" key={d.no}>
              <div className="dept-top">
                <DeptSeal>{d.seal}</DeptSeal>
                <h3>{d.name}</h3>
                <span className="dept-no">{d.no}</span>
              </div>
              <p className="mandate">{d.mandate}</p>
              <div className="evidence">
                <span className={`estamp ${d.tone}`}>{d.toneLabel}</span>
                <div className="elabel">{d.exhibit}</div>
                <div className="efind">{d.finding}</div>
              </div>
            </div>
          ))}
        </Reveal>
      </div>
    </section>
  );
}
