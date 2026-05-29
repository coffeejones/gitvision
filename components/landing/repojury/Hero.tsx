// Hero — "Every repo has a verdict." Hook + case-intake field + the
// verdict-document centerpiece. Entrance animations are immediate
// (CSS, see repojury.css) rather than scroll-triggered.
//
// The intake field + sample chips live in HeroIntake (client) so they
// can route into the real analysis flow; the rest of the hero stays a
// server component.

import { VerdictDoc } from "./VerdictDoc";
import { HeroIntake } from "./HeroIntake";

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
          <HeroIntake />
        </div>
        <VerdictDoc />
      </div>
    </section>
  );
}
