// Hero — "Every repo has a verdict." Hook + case-intake field + the
// verdict-document centerpiece. Entrance animations are immediate
// (CSS, see repojury.css) rather than scroll-triggered.

import { VerdictDoc } from "./VerdictDoc";

const SAMPLES = ["zod", "django", "spring", "gin"];

export function Hero() {
  return (
    <section className="hero spot">
      <div className="wrap hero-grid">
        <div className="hero-copy">
          <div className="case-tag">
            <span className="dot" /> Case intake · open 24/7
          </div>
          <h1>
            Every repo
            <br />
            has a <em>verdict.</em>
          </h1>
          <p className="lede">
            Four departments examine your codebase — health, security, forensics, supply — and return a score you
            can defend. Bus factor, untested hotspots, blast radius, dependency risk. From one URL, in seconds.
          </p>
          <div className="intake">
            <span className="pre">github.com/</span>
            <input type="text" placeholder="your-org/your-repo" aria-label="Repository URL" />
            <button className="btn btn-primary">Open the case</button>
          </div>
          <div className="samples">
            <b>See a sample verdict</b>
            {SAMPLES.map((s) => (
              <a key={s} className="chip" href="#">
                {s}
              </a>
            ))}
          </div>
        </div>
        <VerdictDoc />
      </div>
    </section>
  );
}
