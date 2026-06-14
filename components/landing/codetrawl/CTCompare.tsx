// CTCompare — the competitor contrast as an editorial typeset table:
// hairlines and en-dashes, no checkmark grid. The CodeTrawl column carries
// the table's only orange rule (budget slot 5).
//
// Every cell must be defensible from public documentation (honesty guard —
// each "—" is a claim a competitor's marketing team could try to refute):
// Snyk Code is AST/dataflow-based with call-graph reachability → "partial"
// on structure; CodeScene's hosted product onboards public repos with a Git
// sign-in → "partial" on the URL row; SonarQube ships per-dimension A-E
// ratings + a quality gate → "partial" on a synthesized grade. The dashes
// get sr-only "no" text — screen readers skip bare punctuation.

import { CTReveal } from "./CTReveal";

const COLS = ["SonarQube", "CodeScene", "Snyk", "CodeTrawl"];

const ROWS: { cap: string; vals: [string, string, string, string] }[] = [
  { cap: "Git-history forensics — hotspots, bus factor", vals: ["—", "yes", "—", "yes"] },
  { cap: "AST structure — call graphs, import cycles", vals: ["partial", "partial", "partial", "yes"] },
  { cap: "Dependency advisories across ecosystems", vals: ["partial", "—", "yes", "yes"] },
  { cap: "Secrets & risky-execution patterns", vals: ["yes", "—", "partial", "yes"] },
  { cap: "One synthesized grade for the whole repo", vals: ["partial", "partial", "—", "yes"] },
  { cap: "Paste any public URL — no repo connection, no install, no CI", vals: ["—", "partial", "—", "yes"] },
];

function Cell({ value }: { value: string }) {
  if (value !== "—") return <>{value}</>;
  return (
    <>
      <span aria-hidden>—</span>
      <span className="sr-only">no</span>
    </>
  );
}

export function CTCompare() {
  return (
    <section id="compare" className="section compare">
      <div className="wrap">
        <CTReveal className="rv-block">
          <h2 className="sec-h2">One sweep. Four subscriptions.</h2>
        </CTReveal>
        <CTReveal>
        <div
          className="cmp-scroll"
          tabIndex={0}
          role="region"
          aria-label="Comparison table"
        >
          <table>
            <caption className="sr-only">
              Capability comparison: SonarQube, CodeScene, Snyk, and CodeTrawl
            </caption>
            <thead>
              <tr>
                <th scope="col">
                  <span className="sr-only">Capability</span>
                </th>
                {COLS.map((c) => (
                  <th scope="col" key={c} className={c === "CodeTrawl" ? "ct-col" : undefined}>
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ROWS.map((r, ri) => (
                <tr
                  key={r.cap}
                  className="rv-i"
                  style={{ transitionDelay: `${ri * 80}ms` }}
                >
                  <th scope="row">{r.cap}</th>
                  {r.vals.map((v, i) => (
                    <td key={i} className={i === 3 ? "ct-col" : undefined}>
                      <Cell value={v} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="cmp-note">
          Capability mapping from public product documentation, 2026 — point
          tools go deeper on their own gauge; none combines all four.
        </p>
        <a href="#analyze" className="ct-cta-ghost cmp-cta">
          Run all four on your repo
        </a>
        </CTReveal>
      </div>
    </section>
  );
}
