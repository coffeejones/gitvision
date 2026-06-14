// CTLenses — the four analysis lenses as full-width editorial rows (NOT a
// card grid — rows + hairlines is the system's anti-template move). Each row
// carries a LIVING artifact: the churn strip grows in, the mini call-graph
// draws itself, the check squares cascade, the split bar fills, and the
// figures count up — all triggered on scroll (CTReveal), all in dim/ghost
// ink (the orange budget has no slot here), all stilled by reduced-motion.

import { CTReveal } from "./CTReveal";
import { CTCount } from "./CTCount";

const CHURN_BARS = [3, 5, 4, 8, 6, 12, 7, 5, 9, 22, 11, 6, 8, 14, 5, 7, 18, 6, 4, 9];

function ChurnStrip() {
  return (
    <span className="viz-churn" aria-hidden>
      {CHURN_BARS.map((h, i) => (
        <span
          key={i}
          style={{ height: h, "--bi": i } as React.CSSProperties}
          className={h >= 14 ? "hi" : undefined}
        />
      ))}
    </span>
  );
}

/** Mini call-graph that draws itself in (stroke-dashoffset on the edges,
 *  nodes fading after) — ghost ink, purely illustrative. */
function GraphDraw() {
  return (
    <svg className="viz-graph" viewBox="0 0 150 40" aria-hidden>
      <path
        className="vg-e"
        d="M10 20 H46 M46 20 L84 8 M46 20 L84 32 M84 8 H120 M84 32 H120 M120 8 L140 20 M120 32 L140 20"
      />
      {[
        [10, 20],
        [46, 20],
        [84, 8],
        [84, 32],
        [120, 8],
        [120, 32],
        [140, 20],
      ].map(([cx, cy], i) => (
        <circle
          key={i}
          className="vg-n"
          cx={cx}
          cy={cy}
          r="2.6"
          style={{ "--ni": i } as React.CSSProperties}
        />
      ))}
    </svg>
  );
}

/** Pattern-check squares cascading in — the last one stays brighter
 *  (the one reviewed finding). */
function CheckGrid() {
  return (
    <span className="viz-checks" aria-hidden>
      {Array.from({ length: 12 }, (_, i) => (
        <span
          key={i}
          style={{ "--qi": i } as React.CSSProperties}
          className={i === 11 ? "hit" : undefined}
        />
      ))}
    </span>
  );
}

function SplitBar() {
  return (
    <span className="viz-split">
      <span aria-hidden className="rt" style={{ width: "38%" }} />
      <span className="lbl">runtime 38% · dev 62%</span>
    </span>
  );
}

interface Lens {
  idx: string;
  name: string;
  desc: string;
  chip: React.ReactNode;
  viz: React.ReactNode;
}

const LENSES: Lens[] = [
  {
    idx: "01",
    name: "Git history",
    desc: "Churn × complexity hotspots and bus factor from the full commit graph — plus PR cycle time from recent pull requests.",
    chip: (
      <>
        <CTCount to={58712} /> commits read
      </>
    ),
    viz: <ChurnStrip />,
  },
  {
    idx: "02",
    name: "Structure",
    // 8 = the real tree-sitter plugin coverage (JS+TS, Python, Go, Java,
    // C#, PHP, Ruby) — don't inflate; the audit caught "14" as indefensible.
    desc: "tree-sitter ASTs across 8 languages — call graphs, class maps, import cycles, dead ends.",
    chip: (
      <>
        <CTCount to={41330} /> call edges
      </>
    ),
    viz: <GraphDraw />,
  },
  {
    idx: "03",
    name: "Security",
    desc: "Secret scanning, dynamic-execution patterns, known supply-chain incidents — matched against the record, not guessed.",
    chip: "0 secrets found",
    viz: <CheckGrid />,
  },
  {
    idx: "04",
    name: "Supply chain",
    desc: "Dependencies resolved across npm, Cargo, and PyPI — advisories scoped runtime vs dev before they count.",
    chip: (
      <>
        <CTCount to={1204} /> deps resolved
      </>
    ),
    viz: <SplitBar />,
  },
];

export function CTLenses() {
  return (
    <section id="lenses" className="section lenses">
      <div className="wrap">
        <CTReveal className="rv-block">
          <h2 className="sec-h2">Four lenses. One sweep.</h2>
          {/* Plain-English pairing for the coined terms (lexicon guard). */}
          <p className="lens-deck">
            History, structure, security, supply chain — four ways of reading
            a codebase, computed in the same pass.
          </p>
        </CTReveal>
        <CTReveal>
          <div className="lens-rows">
            {LENSES.map((l, i) => (
              <div
                className="lens-row rv-i"
                key={l.idx}
                style={{ transitionDelay: `${i * 110}ms` }}
              >
                <span className="lens-idx">{l.idx}</span>
                <div className="lens-copy">
                  <h3>{l.name}</h3>
                  <p>{l.desc}</p>
                </div>
                <div className="lens-data">
                  {l.viz}
                  <span className="lens-chip">{l.chip}</span>
                </div>
              </div>
            ))}
          </div>
        </CTReveal>
      </div>
    </section>
  );
}
