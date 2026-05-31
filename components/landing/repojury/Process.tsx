// Process — the consolidated "whole case, start to finish" section for
// the V2 landing. Replaces V1's separate Departments / How-it-works /
// Verdict-in-full / Investigation sections with one process arc, so the
// page stays short while still covering everything Jonas wanted shown:
// how we analyse (intake → sealed exam), what we weigh (4 departments,
// 20 signals), how we present it (verdict), and the case file you
// explore + return to (blast radius, signals, since-last-visit).
//
// Four "acts" on a brass case-timeline rail. Server component; reuses
// the shared feature mockups for the case-file act.

import { Reveal } from "../Reveal";
import { CaseFile } from "./CaseFile";

const DEPTS: { name: string; mandate: string }[] = [
  { name: "Health Department", mandate: "Complexity, duplication, architectural drift" },
  { name: "Security Bureau", mandate: "Secrets, risky patterns, known CVEs" },
  { name: "Forensics Lab", mandate: "Bus factor, untested hotspots, git history" },
  { name: "Supply Office", mandate: "Dependency health, transitive risk" },
];

const DEPT_SCORES: { name: string; val: number; tone: string }[] = [
  { name: "Health", val: 64, tone: "var(--caution)" },
  { name: "Security", val: 91, tone: "var(--cleared)" },
  { name: "Forensics", val: 48, tone: "var(--flagged)" },
  { name: "Supply", val: 88, tone: "var(--cleared)" },
];

export function Process() {
  return (
    <section className="section-pad spot" id="process">
      <div className="wrap">
        <Reveal className="sec-head">
          <span className="eyebrow">How a case works · intake to case file</span>
          <h2 className="display">
            From a URL to a verdict
            <br />
            you can open.
          </h2>
          <p className="lede">
            One pass over your codebase — sealed, examined, judged, then laid
            out as evidence you can explore and come back to. Here&rsquo;s the
            whole process.
          </p>
        </Reveal>

        <div className="acts">
          {/* ACT I — Intake */}
          <Reveal className="act">
            <div className="act-rail">
              <span className="act-no">I</span>
            </div>
            <div className="act-body">
              <span className="act-label">Intake &amp; examination</span>
              <h3>Cloned, read once, destroyed</h3>
              <p>
                Paste a public URL or connect a private repo. We clone it into
                a sealed, in-memory sandbox — parse the AST, walk the git
                history, weigh every dependency — then tear the worker down. We
                keep the findings, never the files.
              </p>
              <div className="act-log">
                10:42:01 clone --in-memory · 10:42:09 4 departments · read-only
                · 10:42:11 destroy() · 0 bytes retained
              </div>
            </div>
          </Reveal>

          {/* ACT II — Departments + signals */}
          <Reveal className="act">
            <div className="act-rail">
              <span className="act-no">II</span>
            </div>
            <div className="act-body">
              <span className="act-label">Four departments · 20 signals</span>
              <h3>Each examines a different surface</h3>
              <p>
                Four investigators file evidence on a different face of your
                repo. Nothing is asserted without a finding behind it.
              </p>
              <div className="act-depts">
                {DEPTS.map((d) => (
                  <div className="act-dept" key={d.name}>
                    <b>{d.name}</b>
                    <span>{d.mandate}</span>
                  </div>
                ))}
              </div>
            </div>
          </Reveal>

          {/* ACT III — Verdict */}
          <Reveal className="act">
            <div className="act-rail">
              <span className="act-no">III</span>
            </div>
            <div className="act-body">
              <span className="act-label">The verdict</span>
              <h3>One score you can defend</h3>
              <p>
                Evidence aggregates into a single ruling — Cleared, Conditional,
                or Returned — with a 0–100 score and a plain-language summary.
                Every point traces back to an exhibit. No black box.
              </p>
              <div className="act-verdict">
                <div className="av-stamp">
                  <span className="av-grade">B&minus;</span>
                  <span className="av-num">72/100</span>
                  <span className="av-ruling">Conditional</span>
                </div>
                <div className="av-bars">
                  {DEPT_SCORES.map((s) => (
                    <div className="av-bar" key={s.name}>
                      <span className="av-bar-name">{s.name}</span>
                      <span className="av-bar-track">
                        <i style={{ width: `${s.val}%`, background: s.tone }} />
                      </span>
                      <span className="av-bar-val">{s.val}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </Reveal>

          {/* ACT IV — The case file */}
          <Reveal className="act">
            <div className="act-rail">
              <span className="act-no">IV</span>
            </div>
            <div className="act-body">
              <span className="act-label">The case file</span>
              <h3>The verdict is where you start</h3>
              <p>
                Each department files its findings in the Chambers — open a
                department to everything it weighed, follow any finding to its
                evidence, and re-run any time. &ldquo;Since your last
                visit&rdquo; shows exactly what moved.
              </p>
              <div className="act-diff">
                <span className="act-diff-dot" /> Since your last visit · Health
                64 → 71 · 2 hotspots cleared · 1 new dependency flagged
              </div>
              <CaseFile />
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
