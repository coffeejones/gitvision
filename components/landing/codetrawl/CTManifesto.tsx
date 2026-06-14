// CTManifesto — the page's editorial statement, immediately grounded by a
// computed artifact (guard: no oversized statement may exist without real
// data in the same viewport — manifesto poetry alone is the fluff-slide).
// The orange phrase is budget slot 4. The trace lines reuse the survey's
// findings and show the claim → signal → conclusion chain in one line each.

import { CTReveal } from "./CTReveal";
import { CTWorkflow } from "./CTWorkflow";

const TRACES = [
  {
    claim: "src/server/render.tsx — churn 47 × complexity 19",
    out: "hotspot",
  },
  {
    claim: "1 high advisory — devDependency only, no runtime path",
    out: "advisory, scoped",
  },
  {
    claim: "packages/core — 81% of changes by one author",
    out: "bus factor 1",
  },
];

export function CTManifesto() {
  return (
    <section id="how" className="section manifesto">
      <div className="wrap">
        <CTReveal className="rv-block">
          {/* The em (orange slot 4) is a PHRASE, not the whole line — a full
              display-size orange sentence out-inked every other slot combined
              and competed with the intake CTA. */}
          <h2>
            The grade is the surface.
            <br />
            The survey is <em>the depth.</em>
          </h2>
          <p className="man-sub">
            One sweep computes every signal — then keeps the working. Each
            line in the survey follows back to the commits, files, and
            manifests it was measured from.
          </p>
        </CTReveal>
        <CTReveal>
          <CTWorkflow />
        </CTReveal>
        <CTReveal>
          <div className="traces" role="group" aria-label="Example signal traces">
            {TRACES.map((t, i) => (
              <div
                className="trace rv-i"
                key={t.out}
                style={{ transitionDelay: `${150 + i * 120}ms` }}
              >
                <span className="t-claim">{t.claim}</span>
                <span className="t-arrow">→</span>
                <span className="t-out">{t.out}</span>
              </div>
            ))}
          </div>
        </CTReveal>
      </div>
    </section>
  );
}
